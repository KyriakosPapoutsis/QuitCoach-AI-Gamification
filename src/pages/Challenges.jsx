/**
 * Challenges.jsx
 * ----------------
 * Purpose: Daily challenges page — generate, list, complete, and react to
 *          challenges; also shows “Your Badges” preview and badge modal.
 *
 * Data Sources:
 * - Firestore:
 *   • users/{uid} (live user doc)
 *   • Challenge (collection: user-owned challenge docs)
 *   • users/{uid}/badges (live list for badge preview + “new” dot)
 *   • users/{uid}/challengePrefs/{challengeId} (like/dislike prefs)
 *   • challenges_catalog/{id} (optional metadata: source/source_org)
 * - REST:
 *   • generateChallenges(count) to fetch AI-generated daily items.
 *
 * Core Flows:
 * - Generate: calls backend once/day → creates Challenge docs for today.
 * - Complete: marks challenge complete and awards points via service helper.
 * - Badge updates: evaluateAndUnlockBadges after actions; modal marks “seen”.
 * - Source button: opens catalog/source URL when available.
 * - “Ask AI Coach”: deep-links to AIChat with a prefilled coaching prompt.
 *
 * UX/Timing:
 * - Re-computes daily at local midnight; prevents multiple generations per day.
 * - Leader pills for difficulty/points; like/dislike floating control.
 *
 * Dev Notes:
 * - Challenge.filter() handles basic querying/sorting/limit.
 * - Catalog metadata (source/source_org) is lazy-fetched for visible items.
 */

import React, { useState, useEffect, useRef } from "react";
import { Challenge } from "@/entities/Challenge";
import { InvokeLLM } from "@/integrations/Core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Trophy,
  Sparkles,
  CheckCircle2,
  Clock,
  Heart,
  Brain,
  Users,
  Coffee
} from "lucide-react";
import { format } from "date-fns";
import { Lock } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/firebase";
import { completeChallengeAndAwardPoints } from "@/services/users";
import {
  doc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  setDoc,
  deleteDoc
} from "firebase/firestore";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { generateChallenges } from "@/integrations/chatApi";
import { evaluateAndUnlockBadges } from "@/services/badges";
import { BADGE_META, getUnlockedBadges, markBadgeSeen } from "@/services/badges";
import { useNavigate } from "react-router-dom";
import { Bot } from "lucide-react";
import { createPageUrl } from "@/utils";
import { getDoc } from "firebase/firestore";



// local "yyyy-MM-dd" (no UTC surprises)
const todayStr = () => format(new Date(Date.now()), "yyyy-MM-dd");

// ms until next local midnight
const msUntilMidnight = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next - now;
};

const pillBtn =
  "rounded-full bg-white/10 hover:bg-white/15 text-white border border-white/20 backdrop-blur-md px-6 py-2.5";

function BadgeGrid({ badges, justUnlockedId, onBadgeClick }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-7">
      {badges.map((b) => (
        <BadgeCard
          key={b.id}
          {...b}
          showDot={b.id === justUnlockedId}
          onClick={() => onBadgeClick?.(b)}   // pass the badge object
        />
      ))}
    </div>
  );
}

function BadgeCard({ title, src, unlocked, showDot = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="soft-card rounded-3xl p-5 border border-white/15 bg-white/5 backdrop-blur-lg
                 shadow-[0_0_30px_rgba(255,255,255,0.08)] hover:shadow-[0_0_40px_rgba(255,255,255,0.16)]
                 transition-shadow text-left w-full"
    >
      <div className="relative w-full aspect-square flex items-center justify-center overflow-visible">
        <img
          src={src}
          alt={title}
          className={`scale-125 object-contain transition
      ${unlocked ? "badge-glow-anim" : "grayscale opacity-50"}`}
          loading="lazy"
        />
        {showDot && (
          <span
            className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 rounded-full bg-red-500 ring-1 ring-black shadow-[0_0_10px_4px_rgba(239,68,68,0.65)]"
            aria-label="New badge"
            title="New"
          />
        )}
        {!unlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl">
            <Lock className="w-8 h-8 text-white/90" />
          </div>
        )}
      </div>
      <div className="mt-4 text-center">
        <div className="text-white text-[1.05rem] font-semibold">{title}</div>
        <div
          className="mx-auto mt-2 h-[6px] w-20 rounded-full"
          style={{ background: "var(--hero-grad)" }}
        />
      </div>
    </button>
  );
}

function BadgeModalView({ badge, onClose }) {
  if (!badge) return null;

  // Format unlocked date if present (Firestore Timestamp)
  let unlockedTxt = null;
  try {
    if (badge.unlockedAt?.toDate) unlockedTxt = badge.unlockedAt.toDate().toLocaleString();
  } catch { }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" aria-modal="true" role="dialog">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {/* content */}
      <div className="relative z-[101] w-[min(92vw,700px)] rounded-2xl border border-white/10 bg-[#0c0f14] p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 sm:p-3 text-white/80 hover:text-white focus:outline-none"
          aria-label="Close"
        >
          <span aria-hidden className="text-3xl sm:text-4xl leading-none">×</span>
        </button>

        <div className="w-full flex items-center justify-center">
          <img src={badge.src} alt={badge.title} className="w-[260px] h-[260px] sm:w-[320px] sm:h-[320px] object-contain drop-shadow-xl" />
        </div>

        <h3 className="mt-4 text-center text-2xl font-bold text-white">{badge.title}</h3>
        <div className="mx-auto mt-3 h-[6px] w-28 rounded-full" style={{ background: "var(--hero-grad)" }} />

        {badge.description && (
          <p className="text-white/80 text-sm sm:text-base mt-4 text-center">{badge.description}</p>
        )}

        {unlockedTxt && (
          <p className="text-white/50 text-xs mt-4 text-center">Unlocked on {unlockedTxt}</p>
        )}
      </div>
    </div>
  );
}



const categoryIcons = {
  physical: Heart,
  mental: Brain,
  social: Users,
  habits: Coffee
};

const difficultyColors = {
  easy: "bg-white/10 text-white/80 border-white/20",
  medium: "bg-white/10 text-white/80 border-white/20",
  hard: "bg-white/10 text-white/80 border-white/20"
};

/* ---------------- Like/Dislike control (saves to users/{uid}/challengePrefs/{challengeId}) ---------------- */
function LikeDislike({ uid, challenge }) {
  const [pref, setPref] = React.useState(null); // 'like' | 'dislike' | null

  React.useEffect(() => {
    if (!uid || !challenge?.id) return;
    const ref = doc(db, "users", uid, "challengePrefs", String(challenge.id));
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.data();
      setPref(d?.preference ?? null);
    });
    return () => unsub();
  }, [uid, challenge?.id]);

  const setPreference = async (next) => {
    if (!uid || !challenge?.id) return;
    const ref = doc(db, "users", uid, "challengePrefs", String(challenge.id));
    if (pref === next) {
      await deleteDoc(ref);
      setPref(null);
    } else {
      await setDoc(
        ref,
        {
          preference: next,
          type: challenge.category ?? null,
          title: challenge.title ?? null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setPref(next);
    }
  };

  const isLiked = pref === "like";
  const isDisliked = pref === "dislike";

  return (
    <div className="flex items-center gap-2">
      {/* Like button */}
      <button
        onClick={() => setPreference("like")}
        disabled={!uid}

        className={`h-8 w-8 rounded-full flex items-center justify-center transition
   ${isLiked
            ? "bg-emerald-400"
            : "hover:bg-white/10 disabled:opacity-50 border border-white/20"}`}
      >
        <ThumbsUp
          className={`w-4 h-4 ${isLiked ? "text-white" : "text-white/85"}`}
          strokeWidth={2.25}
        />
      </button>


      {/* Dislike button */}
      <button
        onClick={() => setPreference("dislike")}
        disabled={!uid}
        className={`h-8 w-8 rounded-full border flex items-center justify-center transition
          ${isDisliked
            ? "bg-rose-400 border-rose-400"
            : "border-white/20 hover:bg-white/10 disabled:opacity-50"
          }`}
        title="I don't like this"
        aria-label="Dislike challenge"
      >
        <ThumbsDown
          className={`w-4 h-4 ${isDisliked ? "text-white" : "text-white/85"}`}
          strokeWidth={2.25}
        />
      </button>
    </div >
  );
}


/**
 * Returns `count` random challenges from the global catalog.
 * Catalog docs shape:
 *   challenges_catalog/{id} {
 *     title, description, category, difficulty, points, active (bool), rand (0..1)
 *   }
 * 
 * TIP: Pre-seed each catalog doc with a float `rand` in [0,1] when you create it.
 * This lets us do efficient random sampling with two bounded queries.
 */
async function pickRandomChallengesFromCatalog(count = 3) {
  const seed = Math.random();

  // 1) forward scan: rand >= seed (ascending)
  const colRef = collection(db, "challenges_catalog");
  const q1 = query(
    colRef,
    where("active", "==", true),
    where("rand", ">=", seed),
    orderBy("rand", "asc"),
    limit(count)
  );

  const out = [];
  const seen = new Set();

  const s1 = await getDocs(q1);
  s1.forEach((docSnap) => {
    if (out.length < count && !seen.has(docSnap.id)) {
      const d = docSnap.data();
      out.push({ id: docSnap.id, ...d });
      seen.add(docSnap.id);
    }
  });

  // 2) if not enough, wrap around: rand < seed (descending)
  if (out.length < count) {
    const needed = count - out.length;
    const q2 = query(
      colRef,
      where("active", "==", true),
      where("rand", "<", seed),
      orderBy("rand", "desc"),
      limit(needed)
    );
    const s2 = await getDocs(q2);
    s2.forEach((docSnap) => {
      if (out.length < count && !seen.has(docSnap.id)) {
        const d = docSnap.data();
        out.push({ id: docSnap.id, ...d });
        seen.add(docSnap.id);
      }
    });
  }

  return out.slice(0, count);
}

export default function Challenges() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const userUnsubRef = useRef(null);
  const [justUnlockedId, setJustUnlockedId] = useState(null);
  // ---- Badges (Your Badges in Challenges tab) ----
  const [yourBadges, setYourBadges] = useState([]);
  const [loadingBadges, setLoadingBadges] = useState(true);
  const [selectedBadge, setSelectedBadge] = useState(null); // modal state (badge object)
  const [catalogMeta, setCatalogMeta] = useState({}); // { [catalog_id]: { source, source_org } }


  const gotoCoachWithPrompt = (prompt) => {
    const safe = (prompt && String(prompt).trim()) || "I want help with this challenge.";
    // If your createPageUrl supports query params, use it; otherwise fallback:
    const url =
      (typeof createPageUrl === "function" && createPageUrl("AIChat", { prefill: safe })) ||
      `/ai?prefill=${encodeURIComponent(safe)}`;
    // Pass BOTH query and state (belt + suspenders)
    navigate(url, { state: { prefill: safe } });
  };




  useEffect(() => {
    if (!selectedBadge) return;
    const onKey = (e) => { if (e.key === "Escape") setSelectedBadge(null); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [selectedBadge]);



  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;  // don’t run if signed out

    if (!uid) { setLoadingBadges(false); return; }

    // catch-up (optional) then live subscribe for instant updates
    evaluateAndUnlockBadges(uid).catch(() => { });

    const colRef = collection(db, "users", uid, "badges");
    const qRef = query(colRef, orderBy("unlockedAt", "desc"));
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = [];
      snap.forEach(d => rows.push({ id: d.id, ...d.data() }));

      // map to UI, keep meta; filter out unknown ids safely
      let items = rows
        .map(r => ({ id: r.id, seen: !!r.seen, unlockedAt: r.unlockedAt, ...BADGE_META[r.id] }))
        .filter(b => b?.title && b?.src);

      // Only newest unseen badge gets the dot (change logic if you want all unseen dotted)
      const newestUnseenId = items.find(b => !b.seen)?.id ?? null;
      setJustUnlockedId(newestUnseenId);
      setYourBadges(items);
      setLoadingBadges(false);
    }, (err) => {
      console.error("Badges live listen failed:", err);
      setLoadingBadges(false);
    });
    return () => unsub();
  }, []);

  const handleBadgeClick = async (badge) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await markBadgeSeen(uid, badge.id);
    } finally {
      setYourBadges(prev => prev.map(b => b.id === badge.id ? { ...b, seen: true } : b));
      setJustUnlockedId((cur) => (cur === badge.id ? null : cur));
      setSelectedBadge(badge); // open modal
    }
  };



  useEffect(() => {
    const t = setTimeout(() => {
      loadData();
    }, msUntilMidnight());
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    loadData();
    return () => {
      if (userUnsubRef.current) {
        userUnsubRef.current();
        userUnsubRef.current = null;
      }
    };
  }, []);

  const loadData = async () => {
    try {
      const cur = getAuth().currentUser;
      const uid = cur?.uid || await new Promise((resolve) => {
        const off = onAuthStateChanged(auth, (u) => { off(); resolve(u?.uid || null); });
      });
      if (!uid) throw new Error("Not signed in");

      if (userUnsubRef.current) {
        userUnsubRef.current();
        userUnsubRef.current = null;
      }
      userUnsubRef.current = onSnapshot(
        doc(db, "users", uid),
        (snap) => {
          const data = snap.data() || {};
          setUser((prev) => ({ ...(prev || {}), id: uid, ...data }));
        },
        (err) => {
          if (err?.code !== "permission-denied" && err?.code !== "unauthenticated") {
            console.error("user onSnapshot error:", err);
          }
        }
      );

      const userChallenges = await Challenge.filter(
        { user_id: uid },
        "-created_date",
        50
      );
      setChallenges(userChallenges);

    } catch (error) {
      console.error("Error loading data:", error);
    }
    setLoading(false);
  };

  const generateDailyChallenges = async () => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;

    setGenerating(true);
    try {
      const today = todayStr();
      const already = challenges.some(c => c.due_date === today);
      if (already) { setGenerating(false); return; }

      // ✅ use your API helper (goes to Express on :8787 via authFetch)
      const { items } = await generateChallenges(3); // [{id,title,description,category,difficulty,points}]

      const newChallenges = items.map(ch => ({
        title: ch.title,
        description: ch.description,
        category: ch.category,
        difficulty: ch.difficulty,
        points: Number(ch.points || 10),
        user_id: uid,
        due_date: today,
        completed: false,
        created_date: new Date().toISOString(),
        catalog_id: ch.id,
        source: ch.source ?? null,
        source_org: ch.source_org ?? null,
        coachPrompt: ch.coachPrompt ?? null,
      }));

      for (const ch of newChallenges) {
        await Challenge.create(ch);
      }

      await loadData();
    } catch (error) {
      console.error("Error generating challenges:", error);
    } finally {
      setGenerating(false);
    }
  };



  const completeChallenge = async (challengeId, points) => {
    try {
      const newTotal = await completeChallengeAndAwardPoints(challengeId, points);
      setChallenges((prev) =>
        prev.map((c) => (c.id === challengeId ? { ...c, completed: true } : c))
      );
      setUser((prev) => ({ ...prev, total_points: newTotal }));
    } catch (error) {
      console.error("Error completing challenge:", error);
      alert("Couldn’t mark complete (permissions or network). Try again.");
    }

    const uid = auth.currentUser?.uid;
    if (uid) {
      const newly = await evaluateAndUnlockBadges(uid).catch(() => []);
      if (newly?.length) setJustUnlockedId(newly[0]);
    }
  };



  const today = todayStr();
  const todayChallenges = challenges.filter(c => c.due_date === today);
  const completedToday = todayChallenges.filter((c) => c.completed);

  // Fetch missing source/source_org from catalog for today's challenges
  useEffect(() => {
    const needs = todayChallenges
      .filter(c => !c.source && c.catalog_id)
      .map(c => String(c.catalog_id));
    const unique = [...new Set(needs)].filter(id => !catalogMeta[id]);
    if (!unique.length) return;
    (async () => {
      const entries = await Promise.all(unique.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "challenges_catalog", id));
          if (!snap.exists()) return [id, { source: null, source_org: null }];
          const d = snap.data() || {};
          return [id, {
            source: d.source || d.source_url || null,
            source_org: d.source_org || d.source_name || null
          }];
        } catch {
          return [id, { source: null, source_org: null }];
        }
      }));
      setCatalogMeta(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
  }, [todayChallenges, catalogMeta]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 bg-[#0c0f14]">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-t-transparent animate-spin"></div>
          <p className="text-gray-300">Loading your Challenges...</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="p-8 text-center bg-[#0c0f14] min-h-screen">
        <p className="text-gray-300">Please sign in to continue</p>
      </div>
    );
  }

  const generatedToday = challenges.some(c => c.due_date === todayStr());
  const disableGenerate = generating || generatedToday;
  const uid = auth.currentUser?.uid || null;

  return (
    <div className="p-6 space-y-6 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Daily Challenges</h1>
          <div
            className="mt-2 mx-auto w-40 h-[6px] rounded-full"
            style={{ background: "var(--hero-grad)" }}
          />
          <p className="text-white/70 mt-3">
            Complete tasks and earn points towards your progress
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <Card className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <CardContent className="pt-6 pb-4">
              <div className="flex flex-col items-center justify-center text-center gap-1.0 min-h-[92px]">
                <Trophy className="w-6 h-6 text-white/80" />
                <div className="text-2xl font-bold text-white leading-tight">
                  {user?.total_points ?? 0}
                </div>
                <p className="text-white/60 text-xs">Total Points Collected</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <CardContent className="pt-6 pb-4">
              <div className="flex flex-col items-center justify-center text-center gap-1.0 min-h-[92px]">
                <CheckCircle2 className="w-6 h-6 text-white/80" />
                <div className="text-2xl font-bold text-white leading-tight">
                  {completedToday.length}
                </div>
                <p className="text-white/60 text-xs">Completed Today</p>
              </div>
              
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <CardContent className="pt-6 pb-4">
              <div className="flex flex-col items-center justify-center text-center gap-1.0 min-h-[92px]">
                <Clock className="w-6 h-6 text-white/80" />
                <div className="text-2xl font-bold text-white leading-tight">
                  {todayChallenges.length - completedToday.length}
                </div>
                <p className="text-white/60 text-xs">Pending Today</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center mb-6">
          <Button
            onClick={generateDailyChallenges}
            disabled={disableGenerate}
            className={`${pillBtn} relative overflow-hidden ${!disableGenerate && !generatedToday ? "neon-border" : ""
              }`}
          >
            {generating ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Generating...
              </div>
            ) : generatedToday ? (
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Come back tomorrow
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Generate New Challenges
              </div>
            )}
          </Button>


        </div>

        <div className="w-fit mx-auto mb-4 rounded-full px-4 py-1.5 bg-white/5 border border-white/10 text-white/70">
          Your challenges for today
        </div>

        <div className="mb-8">
          {todayChallenges.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {todayChallenges.map((challenge) => {
                const CategoryIcon =
                  categoryIcons[challenge.category] ?? Target;
                return (
                  <Card
                    key={challenge.id}
                    className={`relative soft-card rounded-[22px] overflow-hidden transition-all frost-surface border ${challenge.completed
                      ? "bg-emerald-500/10 border-emerald-400/20"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                      } backdrop-blur-md`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex w-10 h-10 items-center justify-center rounded-2xl bg-white/10 border border-white/20 backdrop-blur-sm">
                            <CategoryIcon className="w-5 h-5 text-white/80" />
                          </span>
                          <Badge
                            className={`border ${difficultyColors[challenge.difficulty]}`}
                          >
                            {challenge.difficulty}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Points pill */}
                          <div className="px-3 py-1.5 rounded-full bg-white/10 text-white/85 border border-white/20 text-xs">
                            +{challenge.points} pts
                          </div>
                          <div className="absolute bottom-3 right-3 z-10"></div>
                          {/* ⓘ glass button — links to source (same style as Health card) */}
                          {/* Bottom-left: Info + AI Coach */}
                          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
                            {(() => {
                              const meta = challenge.catalog_id ? catalogMeta[String(challenge.catalog_id)] || {} : {};
                              const sourceUrl = challenge.source || meta.source || null;
                              const sourceOrg = challenge.source_org || meta.source_org || null;
                              const enabled = !!sourceUrl;
                              return (
                                <button
                                  aria-label="View source"
                                  title={enabled ? (sourceOrg || "Source") : "No source provided"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (enabled) window.open(sourceUrl, "_blank", "noopener,noreferrer");
                                  }}
                                  className={`h-8 w-8 rounded-full bg-white/5 border border-white/15 backdrop-blur-md
                                            flex items-center justify-center transition
                                  ${enabled ? "hover:bg-white/10" : "opacity-50 pointer-events-none"}`}
                                >
                                  <svg viewBox="0 0 24 24" className="absolute w-8 h-8" aria-hidden="true">
                                    <defs>
                                      <linearGradient id={`hring-${challenge.id}`} x1="0" y1="0" x2="1" y2="1">
                                        <stop offset="0%" stopColor="#ffffff" />
                                        <stop offset="100%" stopColor="#8e8e8e" />
                                      </linearGradient>
                                    </defs>
                                    <circle cx="12" cy="12" r="9.5" fill="none" stroke={`url(#hring-${challenge.id})`} strokeWidth="2.5" />
                                  </svg>
                                  <span className="relative text-[16px] font-semibold leading-none text-white/90">i</span>
                                </button>
                              );
                            })()}

                            {/* AI Coach */}
                            <button
                              aria-label="Ask AI Coach about this challenge"
                              title="Ask AI Coach"
                              onClick={(e) => {
                                e.stopPropagation();
                                gotoCoachWithPrompt(
                                  challenge.coachPrompt ||
                                  `Help me complete this quit-smoking challenge: "${challenge.title}". Context: ${challenge.description}. Give me a 3-step plan, pitfalls to avoid, and a quick motivational line.`
                                );
                              }}
                              className="
                                    relative inline-flex items-center gap-2
                                    px-3.5 py-1.5 rounded-full
                                    bg-white/5 border border-white/15 backdrop-blur-md text-white
                                    hover:bg-white/10 transition
                                    shadow-[0_0_0_1px_rgba(255,255,255,0.18)]
                                  "
                              style={{
                                // soft glow around the pill border; picks up your theme color if set
                                boxShadow:
                                  "0 0 0 1px rgba(255,255,255,0.18), 0 0 10px rgba(255,255,255,0.15), 0 0 14px var(--hero-grad-first, rgba(255,255,255,0.12))",
                              }}
                            >
                              <Bot className="w-4 h-4 text-white/90" />
                              <span className="text-[12px] font-medium leading-none">Ask AI Coach</span>
                            </button>

                          </div>
                        </div>

                      </div>
                      <CardTitle
                        className={`text-lg ${challenge.completed ? "text-emerald-200" : "text-white"
                          }`}
                      >
                        {challenge.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-2 pb-14">
                      <p
                        className={`text-sm mb-4 ${challenge.completed
                          ? "text-emerald-200/80"
                          : "text-white/75"
                          }`}
                      >
                        {challenge.description}
                      </p>
                      {challenge.completed ? (
                        <div className="flex items-center gap-2 text-emerald-200">
                          <CheckCircle2 className="w-5 h-5" />
                          <span className="font-medium">Completed!</span>
                        </div>
                      ) : (
                        <Button
                          onClick={() =>
                            completeChallenge(challenge.id, challenge.points)
                          }
                          className={`w-full ${pillBtn}`}
                        >
                          Complete
                        </Button>
                      )}
                      <div className="h-2" />

                    </CardContent>
                    {/* Floating like/dislike in card corner */}
                    <div className="absolute bottom-3 right-3 z-10">
                      <LikeDislike uid={uid} challenge={challenge} />
                    </div>

                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md text-center py-10">
              <CardContent>
                <Target className="w-16 h-16 mx-auto mb-4 text-white/50" />
                <h3 className="text-xl font-semibold text-white mb-2">
                  No challenges for today
                </h3>
                <p className="text-white/70">
                  Click the button above to generate personalized challenges
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="mt-4 text-right">
          <Link
            to="/challenges/history"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 bg-white/10 hover:bg-white/15 
               border border-white/20 text-white backdrop-blur-md"
          >
            <Clock className="w-4 h-4" />
            View History
          </Link>
        </div>

        <section className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg md:text-xl font-semibold text-white flex items-center gap-2">
              Your Badges
              <Link
                to="/badges"
                className="flex items-center gap-1 text-white/70 hover:text-white"
                aria-label="View all badges"
              >
                <span className="text-sm font-medium">View All</span>
                <ChevronRight className="w-5 h-5" />
              </Link>
            </h2>
            <div
              className="h-[6px] w-28 rounded-full"
              style={{ background: "var(--hero-grad)" }}
            />
          </div>

          {loadingBadges ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-7">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="soft-card rounded-3xl p-5 border border-white/15 bg-white/5 backdrop-blur-lg animate-pulse aspect-square" />
              ))}
            </div>
          ) : yourBadges.length ? (
            <BadgeGrid
              badges={yourBadges.map(b => ({ ...b, unlocked: true }))}
              justUnlockedId={justUnlockedId}

              onBadgeClick={handleBadgeClick}
            />
          ) : (
            <div className="text-xs text-white/60">No badges yet — keep going to unlock your first one!</div>
          )}

        </section>

      </div>

      <BadgeModalView
        badge={selectedBadge}
        onClose={() => setSelectedBadge(null)}
      />

    </div >
  );
}
