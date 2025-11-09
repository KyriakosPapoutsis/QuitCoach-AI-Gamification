/**
 * server/index.js
 * Main Express backend for the Quit Coach app.
 * - Handles all API routes (auth, AI chat, motivation, challenges, health recovery).
 * - Integrates with Firebase Admin SDK for user data and push notifications.
 * - Uses LangChain (Groq) for AI-assisted responses and recommendations.
 * - Mounts /api/push from server/push.js.
 * - Runs daily push notifications via scheduleDailyPushJobs().
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { ChatGroq } from "@langchain/groq";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { buildPushRouter, scheduleDailyPushJobs } from "./push.js";

const SYSTEM_PROMPT = `
You are an encouraging quit-smoking coach.
- Be supportive and brief.
- Offer practical, evidence-informed tips (triggers, cravings, NRT).
- Avoid medical diagnosis; suggest seeing a clinician when needed.
`;



/* ---------- helpers ---------- */

function toClientChallenge(c) {
  // prefer canonical field names but tolerate variants
  const source = c.source || c.source_url || null;
  const source_org = c.source_org || c.source_name || null;
  const coachPrompt = c.coachPrompt || c.coach_prompt || null; // no generic default here


  return {
    id: c.id,
    title: c.title,
    description: c.description,
    category: c.category || c.type || null,
    difficulty: c.difficulty || null,
    points: c.points || 10,
    source,        
    source_org,    
    coachPrompt,   
  };
}


function sentenceCase(s = "") {
  const t = String(s).trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fmtCurrency(amount, symbol = "€") {
  if (!Number.isFinite(amount)) return null;
  return `${symbol}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function computeMoneySaved(u = {}) {
  const stored = Number(u.money_saved);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  const cigsPerDay = Number(u.cigarettes_per_day_before);
  const cigsPerPack = Number(u.cigarettes_per_pack);
  const costPerPack = Number(u.cost_per_pack);
  const streakDays = Number(u.current_streak_days);
  if (
    [cigsPerDay, cigsPerPack, costPerPack, streakDays].every(Number.isFinite) &&
    cigsPerDay > 0 &&
    cigsPerPack > 0 &&
    costPerPack >= 0 &&
    streakDays >= 0
  ) {
    const dailySpend = (cigsPerDay / cigsPerPack) * costPerPack;
    return dailySpend * streakDays;
  }
  return null;
}
function formatUserContext(u = {}) {
  const name = u.displayName && String(u.displayName).trim();
  const cigsPerDay = Number.isFinite(+u.cigarettes_per_day_before) ? +u.cigarettes_per_day_before : null;
  const cigsPerPack = Number.isFinite(+u.cigarettes_per_pack) ? +u.cigarettes_per_pack : null;
  const costPerPack = Number.isFinite(+u.cost_per_pack) ? +u.cost_per_pack : null;
  const streak = Number.isFinite(+u.current_streak_days) ? +u.current_streak_days : null;

  let reasons = "";
  if (Array.isArray(u.quit_reasons)) {
    reasons = u.quit_reasons.filter(Boolean).slice(0, 8).join(", ");
  } else if (typeof u.quit_reasons === "string") {
    reasons = u.quit_reasons.trim();
  }

  const savedRaw = computeMoneySaved(u);
  const savedStr = fmtCurrency(savedRaw, u.currency_symbol || "€");

  const lines = [
    name ? `Name: ${name}` : null,
    cigsPerDay != null ? `Cigarettes/day before: ${cigsPerDay}` : null,
    cigsPerPack != null ? `Cigarettes per pack: ${cigsPerPack}` : null,
    costPerPack != null ? `Cost per pack: ${costPerPack}` : null,
    streak != null ? `Current streak (days): ${streak}` : null,
    savedStr ? `Estimated money saved so far: ${savedStr}` : null,
    reasons ? `Quit reasons: ${reasons}` : null,
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "No user context available.";
}
function topCounts(arr = [], n = 6) {
  const m = new Map();
  for (const t of arr) if (t) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
async function getChallengePrefsSummary(fdb, uid) {
  const usersRef = fdb.collection("users").doc(uid);
  let likes = [],
    dislikes = [];
  try {
    const prefSnap = await usersRef.collection("challengePrefs").limit(500).get();
    for (const d of prefSnap.docs) {
      const p = d.data() || {};
      const key = p.type || p.title || d.id;
      if (p.preference === "like") likes.push(key);
      if (p.preference === "dislike") dislikes.push(key);
    }
  } catch { }
  const likedTop = topCounts(likes).map(([k, v]) => `${k} (${v})`).join(", ");
  const dislikedTop = topCounts(dislikes).map(([k, v]) => `${k} (${v})`).join(", ");
  if (!likedTop && !dislikedTop) return "No challenge preferences yet.";
  return [
    likedTop ? `Preferred challenges: ${likedTop}` : null,
    dislikedTop ? `Avoided challenges: ${dislikedTop}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
// Read the user's selected quit reasons and return a short, comma-separated line.
async function getQuitReasonsText(fdb, uid) {
  try {
    const snap = await fdb.collection("users").doc(uid).get();
    if (!snap.exists) return "";
    const u = snap.data() || {};
    if (Array.isArray(u.quit_reasons)) {
      return u.quit_reasons.filter(Boolean).slice(0, 12).join(", ");
    }
    if (typeof u.quit_reasons === "string") {
      return u.quit_reasons.trim();
    }
  } catch { }
  return "";
}
function safeNameFrom(data = {}) {
  const s = data.displayName ? String(data.displayName).trim() : "";
  return s || "User";
}
async function getLeaderboardSummary(fdb, selfUid) {
  try {
    const users = fdb.collection("users");
    const [pointsSnap, streakSnap] = await Promise.all([
      users.orderBy("total_points", "desc").limit(12).get(),
      users.orderBy("current_streak_days", "desc").limit(12).get(),
    ]);

    const topPoints = pointsSnap.docs
      .map((d) => {
        const data = d.data() || {};
        return { id: d.id, name: safeNameFrom(data), val: Number(data.total_points) || 0 };
      })
      .filter((r) => Number.isFinite(r.val) && r.val >= 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 10);

    const topStreak = streakSnap.docs
      .map((d) => {
        const data = d.data() || {};
        return { id: d.id, name: safeNameFrom(data), val: Number(data.current_streak_days) || 0 };
      })
      .filter((r) => Number.isFinite(r.val) && r.val >= 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 10);

    const sample = new Map();
    streakSnap.docs.forEach((d) => sample.set(d.id, d.data() || {}));
    pointsSnap.docs.forEach((d) => sample.set(d.id, d.data() || {}));

    const savedRows = [];
    for (const [id, data] of sample) {
      const val = computeMoneySaved(data);
      if (Number.isFinite(val) && val >= 0) {
        savedRows.push({
          id,
          name: safeNameFrom(data),
          val,
          symbol: data.currency_symbol || "€",
        });
      }
    }
    savedRows.sort((a, b) => b.val - a.val);
    const topSaved = savedRows.slice(0, 10);

    const lines = [];
    if (topPoints.length) {
      lines.push("Top 10 by points:");
      lines.push(...topPoints.map((r, i) => `${i + 1}. ${r.name}${r.id === selfUid ? " (you)" : ""} — ${r.val}`));
    }
    if (topStreak.length) {
      if (lines.length) lines.push("");
      lines.push("Top 10 by streak (days):");
      lines.push(...topStreak.map((r, i) => `${i + 1}. ${r.name}${r.id === selfUid ? " (you)" : ""} — ${r.val}`));
    }
    if (topSaved.length) {
      if (lines.length) lines.push("");
      lines.push("Top 10 by money saved:");
      lines.push(
        ...topSaved.map(
          (r, i) =>
            `${i + 1}. ${r.name}${r.id === selfUid ? " (you)" : ""} — ${fmtCurrency(r.val, r.symbol) || r.val.toFixed(0)}`
        )
      );
    }
    return lines.length ? lines.join("\n") : "No leaderboard data yet.";
  } catch {
    return "No leaderboard data yet.";
  }
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function truncate(s, n) {
  if (!s) return "";
  s = String(s);
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
async function fetchRandomCatalogCandidates(fdb, count = 30) {
  const seed = Math.random();
  const colRef = fdb.collection("challenges_catalog");
  const q1 = colRef.where("active", "==", true).where("rand", ">=", seed).orderBy("rand", "asc").limit(count);
  const out = [];
  const seen = new Set();
  const s1 = await q1.get();
  s1.forEach((doc) => {
    if (out.length < count && !seen.has(doc.id)) {
      out.push({ id: doc.id, ...doc.data() });
      seen.add(doc.id);
    }
  });
  if (out.length < count) {
    const needed = count - out.length;
    const q2 = colRef.where("active", "==", true).where("rand", "<", seed).orderBy("rand", "desc").limit(needed);
    const s2 = await q2.get();
    s2.forEach((doc) => {
      if (out.length < count && !seen.has(doc.id)) {
        out.push({ id: doc.id, ...doc.data() });
        seen.add(doc.id);
      }
    });
  }
  return out;
}
async function chooseChallengesWithAI(llm, userPrefText, candidates, k = 3) {
  const slim = candidates.slice(0, 40).map((c) => ({
    id: c.id,
    title: truncate(c.title, 80),
    type: c.category || c.type || null,
    difficulty: c.difficulty || null,
    points: c.points || null,
    description: truncate(c.description || "", 160),
  }));
  const sys = `
You are a recommendation engine for a quit-smoking app. 
Pick exactly ${k} challenges from a provided candidate list that match the user's preferences.
Rules:
- Prefer the user's liked types; avoid disliked types.
- Also consider the user's quit reasons to align choices with their motivations.
- Aim for variety (not all the same type/difficulty).
- Only choose from the provided candidate "id"s.
- Output ONLY valid JSON with this shape:
{"choices":[{"id":"<candidateId>","reason":"<short reason>"}]}
No extra text, no markdown.
`.trim();
  const user = `
USER PREFERENCES
${userPrefText}

CANDIDATES
${JSON.stringify(slim, null, 2)}
`.trim();
  try {
    const ai = await llm.invoke([{ role: "system", content: sys }, { role: "user", content: user }]);
    const text = String(ai.content || "").trim();
    const parsed = JSON.parse(text);
    const pickedIds = Array.isArray(parsed?.choices) ? parsed.choices.map((c) => c.id).filter(Boolean) : [];
    const uniq = [...new Set(pickedIds)].slice(0, k);
    if (uniq.length) {
      const byId = new Map(candidates.map((c) => [c.id, c]));
      return uniq.map((id) => byId.get(id)).filter(Boolean);
    }
  } catch { }
  const likedSet = new Set();
  const dislikedSet = new Set();
  const quitKeywords = new Set();
  const likeLine = userPrefText.split("\n").find((l) => l.toLowerCase().startsWith("preferred challenges:"));
  const dislikeLine = userPrefText.split("\n").find((l) => l.toLowerCase().startsWith("avoided challenges:"));
  const quitLine = userPrefText.split("\n").find((l) => l.toLowerCase().startsWith("quit reasons:"));
  const extract = (line) =>
    (line || "")
      .split(":")[1]
      ?.split(",")
      .map((t) => t.trim().replace(/\s*\(\d+\)\s*$/, ""))
      .filter(Boolean) || [];
  extract(likeLine).forEach((t) => likedSet.add(t));
  extract(dislikeLine).forEach((t) => dislikedSet.add(t));
  extract(quitLine).forEach((t) => {
    const s = String(t).toLowerCase();
    if (s) quitKeywords.add(s);
  });
  const scored = candidates
    .map((c) => {
      const t = c.category || c.type || "";
      let score = 0;
      if (likedSet.has(t)) score += 2;
      if (dislikedSet.has(t)) score -= 5;
      if ((c.difficulty || "").toLowerCase() === "medium") score += 0.5;
      // Light boost if quit-reason keywords appear in title/description
      const text = `${c.title} ${c.description || ""}`.toLowerCase();
      let hits = 0;
      for (const kw of quitKeywords) {
        if (kw && text.includes(kw)) { hits += 1; if (hits >= 3) break; }
      }
      if (hits) score += Math.min(1.5, 0.6 * hits); // cap the boost
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > -5).slice(0, k).map((x) => x.c);
}

/* ---------- Initialize Firebase Admin (service account or env credentials) ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credPath = path.join(__dirname, "firebase-admin.json");

if (!admin.apps.length) {
  if (fs.existsSync(credPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } else {
    throw new Error(
      "No Firebase Admin credentials found. Put server/firebase-admin.json or set GOOGLE_APPLICATION_CREDENTIALS."
    );
  }
}
const fdb = admin.firestore();

/* ---------- Express base ---------- */
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* ---------- LLM ---------- */
const llm = new ChatGroq({ model: "llama-3.3-70b-versatile", temperature: 0.4 });

/* ---------- Auth middleware ---------- */
async function requireFirebaseAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: "Missing Authorization Bearer token" });
    const decoded = await admin.auth().verifyIdToken(m[1]);
    req.uid = decoded.uid;
    next();
  } catch (e) {
    console.error("Auth error:", e);
    return res.status(401).json({ error: "Invalid ID token", detail: e.message });
  }
}

/* ---------- Public health check ---------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: !!process.env.GROQ_API_KEY });
});

/* ---------- Protected API (requires Firebase auth) ---------- */
const api = express.Router();
api.use(requireFirebaseAuth);

// PUSH (protected)
api.use("/push", buildPushRouter(admin, fdb));

/* Motivation moderation + post */
api.post("/motivation", async (req, res) => {
  try {
    const { message } = req.body || {};
    const raw = (message ?? "").toString().trim();

    if (!raw) return res.status(400).json({ error: "Message cannot be empty." });
    if (raw.length > 100) return res.status(400).json({ error: "Message must be ≤ 100 characters." });

    // quick rule-based profanity guard
    const profanity = new Set(["damn", "hell", "shit", "fuck", "bitch", "asshole", "bastard", "crap", "dick"]);
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/);
    if (cleaned.some((w) => profanity.has(w))) {
      return res.status(400).json({ error: "Please remove profanity." });
    }

    const sys =
      'Return ONLY JSON: {"ok":boolean,"reasons":string[],"categories":{"motivational":boolean,"profanity":boolean,"hate":boolean,"harassment":boolean,"selfHarm":boolean}}. Rules: Approve only if uplifting AND clean.';
    const userMsg = `Text: "${raw}"`;
    try {
      const ai = await llm.invoke([{ role: "system", content: sys }, { role: "user", content: userMsg }]);
      const j = JSON.parse(String(ai.content || "{}"));
      if (!j.ok) {
        const reason = (Array.isArray(j.reasons) && j.reasons[0]) || "Not motivational enough.";
        return res.status(400).json({ error: sentenceCase(reason) });
      }
    } catch { }

    // Persist as APPROVED
    const usersRef = fdb.collection("users").doc(req.uid);
    const profile = await usersRef.get().catch(() => null);
    const authorName = profile?.exists ? profile.data().displayName || "User" : "User";

    const docRef = await fdb.collection("motivation_posts").add({
      uid: req.uid,
      authorName,
      message: raw,
      approved: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ id: docRef.id, message: raw, authorName });
  } catch (e) {
    console.error("POST /motivation error:", e);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/* List latest approved */
api.get("/motivation", async (_req, res) => {
  try {
    const snap = await fdb
      .collection("motivation_posts")
      .where("approved", "==", true)
      .orderBy("createdAt", "desc")
      .limit(24)
      .get();
    res.json({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* List conversations */
api.get("/conversations", async (req, res) => {
  try {
    const snap = await fdb
      .collection("users")
      .doc(req.uid)
      .collection("conversations")
      .orderBy("updatedAt", "desc")
      .limit(50)
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) {
    console.error("GET /conversations error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* Get messages */
api.get("/messages", async (req, res) => {
  try {
    const { conversationId } = req.query;
    if (!conversationId) return res.status(400).json({ error: "conversationId required" });
    const convoRef = fdb.collection("users").doc(req.uid).collection("conversations").doc(String(conversationId));
    const exists = await convoRef.get();
    if (!exists.exists) return res.status(404).json({ error: "Conversation not found" });
    const mq = await convoRef.collection("messages").orderBy("createdAt", "asc").get();
    res.json(mq.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) {
    console.error("GET /messages error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* AI chat */
api.post("/ai/chat", async (req, res) => {
  try {
    const { conversationId, userMessage } = req.body || {};
    if (!userMessage || !String(userMessage).trim()) return res.status(400).json({ error: "userMessage required" });

    const usersRef = fdb.collection("users").doc(req.uid);
    const convosRef = usersRef.collection("conversations");

    let convoRef;
    if (conversationId) {
      convoRef = convosRef.doc(String(conversationId));
      const snap = await convoRef.get();
      if (!snap.exists) return res.status(404).json({ error: "Conversation not found" });
    } else {
      const title = String(userMessage).slice(0, 60) || "New conversation";
      convoRef = convosRef.doc();
      await convoRef.set({
        title,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const msgsRef = convoRef.collection("messages");
    await msgsRef.add({
      role: "user",
      content: String(userMessage),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const recentSnap = await msgsRef.orderBy("createdAt", "asc").limitToLast(30).get();
    const recent = recentSnap.docs.map((d) => d.data());

    let userCtx = "No user context available.";
    try {
      const udoc = await usersRef.get();
      if (udoc.exists) userCtx = formatUserContext(udoc.data() || {});
    } catch (e) {
      console.warn("Failed to fetch user profile for prompt context:", e.message);
    }

    let prefsText = "";
    try {
      prefsText = await getChallengePrefsSummary(fdb, req.uid);
    } catch { }

    let leaderboardText = "";
    try {
      leaderboardText = await getLeaderboardSummary(fdb, req.uid);
    } catch { }

    const systemContent = `
${SYSTEM_PROMPT.trim()}

USER CONTEXT
${userCtx}

CHALLENGE PREFERENCES
${prefsText || "No challenge preferences yet."}

LEADERBOARDS
${leaderboardText || "No leaderboard data yet."}
`.trim();

    const messages = [{ role: "system", content: systemContent }, ...recent.map((m) => ({ role: m.role, content: m.content }))];
    const ai = await llm.invoke(messages);

    await msgsRef.add({
      role: "assistant",
      content: ai.content,
      tokenCount: ai.response_metadata?.tokenUsage?.totalTokens ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await convoRef.update({ updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    res.json({ conversationId: convoRef.id, reply: ai.content });
  } catch (e) {
    console.error("POST /ai/chat error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* AI challenge generation */
api.post("/ai/generate-challenges", async (req, res) => {
  try {
    const k = clamp(Number(req.body?.count || 3), 1, 5);
    const prefText = await getChallengePrefsSummary(fdb, req.uid);
    const quitReasons = await getQuitReasonsText(fdb, req.uid);
    const prefPlusReasons = quitReasons
      ? `${prefText}\n\nQuit reasons: ${quitReasons}`
      : prefText;
    const candidates = await fetchRandomCatalogCandidates(fdb, 40);
    if (!candidates.length) return res.status(404).json({ error: "No active challenges in catalog." });
    const chosen = await chooseChallengesWithAI(llm, prefPlusReasons, candidates, k);
    if (!chosen || !chosen.length) return res.status(500).json({ error: "Failed to select challenges." });
    const result = chosen.slice(0, k).map(toClientChallenge);
    res.json({ preferences: prefText, items: result });
  } catch (e) {
    console.error("POST /ai/generate-challenges error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* Health recovery: phrase + progress + source (single source of truth) */
api.get("/ai/health-recovery", async (req, res) => {
  try {
    // Milestones (days since quit). Sources = WHO / CDC / NHS / ACS / NIH.
    const M = [
      {
        id: "day0_20min", label: "Within 20 minutes", startDay: 0, nextAtDay: 1,
        fact: "Heart rate and blood pressure start to drop within 20 minutes.",
        sources: [{ org: "WHO", title: "Health benefits of smoking cessation", url: "https://www.who.int/news-room/questions-and-answers/item/tobacco-health-benefits-of-smoking-cessation" }]
      },
      {
        id: "day0_8h", label: "8 hours", startDay: 0, nextAtDay: 1,
        fact: "Oxygen levels recover; carbon monoxide has fallen by about half.",
        sources: [{ org: "NHS", title: "Quit smoking – Better Health", url: "https://www.nhs.uk/better-health/quit-smoking/" }]
      },
      {
        id: "day1_12_24h", label: "12–24 hours", startDay: 1, nextAtDay: 2,
        fact: "Carbon monoxide returns to normal (~12h); nicotine levels drop to zero by 24h.",
        sources: [{ org: "WHO", title: "Health benefits of smoking cessation", url: "https://www.who.int/news-room/questions-and-answers/item/tobacco-health-benefits-of-smoking-cessation" }]
      },
      {
        id: "day2_48h", label: "48 hours", startDay: 2, nextAtDay: 3,
        fact: "Taste and smell begin improving as lungs clear mucus.",
        sources: [{ org: "NHS", title: "Quit smoking – Better Health", url: "https://www.nhs.uk/better-health/quit-smoking/" }]
      },
      {
        id: "day3_72h", label: "72 hours", startDay: 3, nextAtDay: 14,
        fact: "Breathing feels easier as airways relax; energy can rise.",
        sources: [{ org: "NHS", title: "Quit smoking – Better Health", url: "https://www.nhs.uk/better-health/quit-smoking/" }]
      },
      {
        id: "wk2_to_wk12", label: "2–12 weeks", startDay: 14, nextAtDay: 90,
        fact: "Circulation improves; lung function begins to increase.",
        sources: [
          { org: "WHO", title: "Health benefits of smoking cessation", url: "https://www.who.int/news-room/questions-and-answers/item/tobacco-health-benefits-of-smoking-cessation" },
          { org: "NHS", title: "Quit smoking – Better Health", url: "https://www.nhs.uk/better-health/quit-smoking/" },
        ]
      },
      {
        id: "mo1", label: "1 month", startDay: 30, nextAtDay: 90,
        fact: "Cilia recover; airways clear mucus better; infection risk drops.",
        sources: [{ org: "MedlinePlus (NIH)", title: "Benefits of quitting tobacco", url: "https://medlineplus.gov/ency/article/007532.htm" }]
      },
      {
        id: "mo3", label: "3 months", startDay: 90, nextAtDay: 180,
        fact: "Coughing and breathlessness keep improving; lung function trending up.",
        sources: [{ org: "NHS", title: "Quit smoking – Better Health", url: "https://www.nhs.uk/better-health/quit-smoking/" }]
      },
      {
        id: "mo6", label: "6 months", startDay: 180, nextAtDay: 270,
        fact: "Many people cough less and bring up less phlegm as lungs heal (months 1–9).",
        sources: [{ org: "MedlinePlus (NIH)", title: "Benefits of quitting tobacco", url: "https://medlineplus.gov/ency/article/007532.htm" }]
      },
      {
        id: "mo9", label: "9 months", startDay: 270, nextAtDay: 365,
        fact: "Lung function may be ~10% higher than at quit; breathlessness eases.",
        sources: [{ org: "NHS", title: "Quit smoking – Better Health", url: "https://www.nhs.uk/better-health/quit-smoking/" }]
      },
      {
        id: "1year", label: "1 year", startDay: 365, nextAtDay: 730,
        fact: "Risk of coronary heart disease is about half that of someone who smokes.",
        sources: [{ org: "WHO", title: "Health benefits of smoking cessation", url: "https://www.who.int/news-room/questions-and-answers/item/tobacco-health-benefits-of-smoking-cessation" }]
      },
      {
        id: "1_to_2_years", label: "1–2 years", startDay: 365, nextAtDay: 1095,
        fact: "Risk of heart attack drops sharply within 1–2 years after quitting.",
        sources: [
          { org: "CDC", title: "Benefits of Quitting Smoking", url: "https://www.cdc.gov/tobacco/about/benefits-of-quitting.html" },
          { org: "CDC", title: "Cigarettes & cardiovascular disease", url: "https://www.cdc.gov/tobacco/about/cigarettes-and-cardiovascular-disease.html" },
        ]
      },
      {
        id: "3_to_6_years", label: "3–6 years", startDay: 1095, nextAtDay: 2190,
        fact: "Added risk of coronary heart disease drops by about half by 3–6 years.",
        sources: [{ org: "CDC", title: "Cigarettes & cardiovascular disease", url: "https://www.cdc.gov/tobacco/about/cigarettes-and-cardiovascular-disease.html" }]
      },
      {
        id: "5_to_10_years", label: "5–10 years", startDay: 2190, nextAtDay: 3650,
        fact: "Risk of stroke decreases; mouth/throat/larynx cancer risk is cut about in half.",
        sources: [
          { org: "American Cancer Society", title: "Benefits over time", url: "https://www.cancer.org/cancer/risk-prevention/tobacco/guide-quitting-smoking/benefits-of-quitting-smoking-over-time.html" },
          { org: "CDC", title: "Benefits of Quitting Smoking", url: "https://www.cdc.gov/tobacco/about/benefits-of-quitting.html" },
        ]
      },
      {
        id: "10years", label: "10 years", startDay: 3650, nextAtDay: 5475,
        fact: "Risk of dying from lung cancer is about half that of a current smoker.",
        sources: [{ org: "American Cancer Society", title: "Benefits over time", url: "https://www.cancer.org/cancer/risk-prevention/tobacco/guide-quitting-smoking/benefits-of-quitting-smoking-over-time.html" }]
      },
      {
        id: "15years", label: "15 years", startDay: 5475, nextAtDay: 5475,
        fact: "Risk of coronary heart disease approaches that of a nonsmoker.",
        sources: [{ org: "CDC", title: "Cigarettes & cardiovascular disease", url: "https://www.cdc.gov/tobacco/about/cigarettes-and-cardiovascular-disease.html" }]
      },
    ];

    // Fetch user & streak days
    const usersRef = fdb.collection("users").doc(req.uid);
    const snap = await usersRef.get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });

    const u = snap.data() || {};
    let days = Number.isFinite(+u.current_streak_days) ? +u.current_streak_days : 0;
    if (!Number.isFinite(days) || days < 0) {
      const sinceStr = u.streak_start_date || u.quit_date || null;
      if (sinceStr) {
        const since = new Date(sinceStr); since.setHours(0, 0, 0, 0);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        days = Math.max(0, Math.floor((today - since) / 86400000));
      } else {
        days = 0;
      }
    }

    // Pick stage & progress to next
    let stage = M[0];
    for (const s of M) if (days >= s.startDay) stage = s;
    const start = stage.startDay;
    const end = Math.max(stage.nextAtDay, start + 1);
    const progressPct = Math.round(((Math.min(Math.max(days, start), end) - start) / (end - start)) * 100);

    const bestSource = (stage.sources && stage.sources[0]) || null;

    // Generate short, complete sentences (fallback if model/key unavailable)
    let phrases = [
      `You’re progressing toward ${stage.label.toLowerCase()}—keep going.`,
      `Each day moves you closer to ${stage.label.toLowerCase()}.`,
      `Stay the course—your body is repairing itself.`,
    ];

    if (process.env.GROQ_API_KEY) {
      try {
        const sys = `
Return ONLY JSON: {"phrases":["...","...","..."]}.
Rules:
- 3–5 complete sentences, 8–18 words each.
- Second person, present tense, encouraging, clinically aligned with the FACT.
- No fragments, no emojis, no markdown.
        `.trim();
        const user = `
STAGE: ${stage.label}
FACT: ${stage.fact}
SOURCE: ${bestSource?.org || ""}: ${bestSource?.title || ""}
        `.trim();
        const out = await llm.invoke([{ role: "system", content: sys }, { role: "user", content: user }]);
        const j = JSON.parse(String(out.content || "{}"));
        if (Array.isArray(j.phrases) && j.phrases.length) {
          phrases = j.phrases
            .map(s => String(s || "").trim())
            .filter(Boolean)
            .map(s => (s[0] ? s[0].toUpperCase() + s.slice(1) : s))
            .map(s => /[.!?]$/.test(s) ? s : s + ".");
        }
      } catch (e) {
        console.warn("health-recovery AI phrases fallback:", e?.message || e);
      }
    }

    const idx = phrases.length ? (new Date().getHours() % phrases.length) : 0;

    res.json({
      streakDays: days,
      stage: { id: stage.id, label: stage.label, startDay: stage.startDay, nextAtDay: stage.nextAtDay },
      progressPct,
      fact: stage.fact,
      phrases,
      phrase: phrases[idx],
      source: bestSource,
      sources: stage.sources,
    });
  } catch (e) {
    console.error("GET /ai/health-recovery failed:", e);
    // Soft fallback instead of 500
    res.json({
      progressPct: 0,
      stage: { id: "unknown", label: "Health milestone" },
      phrase: "Health info is temporarily unavailable. You’re still making progress.",
      phrases: ["Health info is temporarily unavailable. You’re still making progress."],
      fact: null,
      source: null,
    });
  }
});




/* AI JSON utility */
api.post("/ai/json", async (req, res) => {
  try {
    const { system, prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
    const ai = await llm.invoke(messages);
    let json;
    try {
      json = JSON.parse(ai.content);
    } catch {
      return res.status(422).json({ error: "Model did not return valid JSON", content: ai.content });
    }
    res.json(json);
  } catch (e) {
    console.error("POST /ai/json error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.use("/api", api);

/* Start Express server */
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`API listening on ${port}`));

/* Cron jobs (20:30 / 20:35 Europe/Athens) */
scheduleDailyPushJobs(admin, fdb);
