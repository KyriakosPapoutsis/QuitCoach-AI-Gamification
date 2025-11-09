/**
 * Community.jsx
 * --------------
 * Purpose: Community overview — leaderboard (points/streak/saved), global
 *          aggregate stats, and a live “Motivation Wall” with AI-moderated posts.
 *
 * Data:
 * - Firestore:
 *   • leaderboard (top 10 by selected metric; also scanned for aggregates)
 *   • motivation_posts (approved==true, ordered by createdAt desc, live)
 * - REST:
 *   • POST /api/motivation for user-submitted messages (requires Firebase ID token).
 *
 * UX:
 * - Metric switcher tabs (Points / Streak / Saved) drive leaderboard order.
 * - Stats cards for members, longest streak, total money saved, life regained.
 * - Motivation Wall: inline create (max 100 chars) + live approved feed.
 *
 * Error Handling:
 * - POST gracefully parses JSON/text error bodies; shows friendly messages.
 * - Firestore subscriptions log (not crash) on transient errors.
 *
 * Dev Notes:
 * - Uses VITE_API_URL base (no hardcoded server URL).
 * - Enforces auth before posting; displays character countdown and errors.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Crown, Flame, Heart, DollarSign, Users, Megaphone, User as UserIcon } from "lucide-react";
import { db } from "@/firebase";
import { collection, query, orderBy, limit, doc, getDoc, getDocs } from "firebase/firestore";
import { where, onSnapshot } from "firebase/firestore";
import { getFirebaseIdToken } from "@/firebase";

async function postMotivation(message) {
  const token = await getFirebaseIdToken(true);
  if (!token) throw new Error("Please sign in to post.");
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

  const res = await fetch(`${base}/api/motivation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
  });

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    // Prefer JSON error, but gracefully fall back to text
    if (contentType.includes("application/json")) {
      const data = await res.json().catch(() => ({}));
      const msg = data?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    } else {
      const text = await res.text().catch(() => "");
      // if server sent JSON but wrong header, try parse
      let msg = text || `HTTP ${res.status}`;
      try {
        const data = JSON.parse(text);
        msg = data?.error || msg;
      } catch { }
      throw new Error(msg);
    }
  }

  return contentType.includes("application/json") ? res.json() : res.text();
}




const pill = "rounded-full bg-white/10 border border-white/20 backdrop-blur-md px-3 py-1 text-xs";
export default function Community() {
  const [mode, setMode] = React.useState("points"); // 'points' | 'streak' | 'saved'
  const [leaderboard, setLeaderboard] = React.useState([]);
  const [stats, setStats] = React.useState({
    members: 0,
    longest_streak_days: 0,
    total_money_saved: 0,
    life_regained_years: 0,
  });

  // Motivation Wall (inline)
  const [motivationText, setMotivationText] = React.useState("");
  const [motivationErr, setMotivationErr] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const [motivationItems, setMotivationItems] = React.useState([]);
  const MAX_LEN = 100;


  React.useEffect(() => {
    (async () => {
      try {
        // Top 10
        const lbQ = query(collection(db, "leaderboard"), orderBy("points", "desc"), limit(10));
        const lbSnap = await getDocs(lbQ);
        setLeaderboard(lbSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Stats from all rows (small/medium apps this is fine)
        const allSnap = await getDocs(collection(db, "leaderboard"));
        let members = 0, longest = 0, total_money_saved = 0, life_years = 0;
        allSnap.forEach(s => {
          const v = s.data() || {};
          members += 1;
          longest = Math.max(longest, Number(v.streak || 0));
          total_money_saved += Number(v.saved || 0);
          life_years += Number(v.lifeYears || 0);
        });
        setStats({
          members,
          longest_streak_days: longest,
          total_money_saved: Math.round(total_money_saved),
          life_regained_years: life_years,
        });
      } catch (e) {
        console.error("Community data load error:", e);
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const lbQ = query(collection(db, "leaderboard"), orderBy(mode, "desc"), limit(10));
        const lbSnap = await getDocs(lbQ);
        setLeaderboard(lbSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Community leaderboard load error:", e);
      }
    })();
  }, [mode]);

  // Live approved motivation posts
  React.useEffect(() => {
    const q = query(
      collection(db, "motivation_posts"),
      where("approved", "==", true),
      orderBy("createdAt", "desc"),
      limit(12)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setMotivationItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("Motivation wall subscribe error:", err)
    );
    return () => unsub();
  }, []);

  async function submitMotivation(e) {
    e.preventDefault();
    setMotivationErr("");
    const t = motivationText.trim();
    if (!t) return setMotivationErr("Please write something inspiring.");
    if (t.length > MAX_LEN) return setMotivationErr(`Max ${MAX_LEN} characters.`);
    setPosting(true);
    try {
      await postMotivation(t);   // AI-checked on the server
      setMotivationText("");
    } catch (err) {
      setMotivationErr(String(err.message || "Failed to post"));
    } finally {
      setPosting(false);
    }
  }



  const renderMetric = React.useCallback((u) => {
    if (mode === "points") {
      return (
        <span className="flex items-center gap-1">
          <Trophy className="w-3 h-3 text-yellow-400" />
          {(u.points ?? 0).toLocaleString()} pts
        </span>
      );
    }
    if (mode === "streak") {
      return (
        <span className="flex items-center gap-1">
          <Flame className="w-3 h-3 text-orange-400" />
          {u.streak ?? 0}d
        </span>
      );
    }
    // saved
    return (
      <span className="flex items-center gap-1">
        <DollarSign className="w-3 h-3 text-green-400" />
        €{(u.saved ?? 0).toLocaleString()}
      </span>
    );
  }, [mode]);

  return (
    <div className="bg-[#0c0f14] min-h-screen text-white p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold">Community</h1>
          <div
            className="mt-2 mx-auto w-40 h-[6px] rounded-full"
            style={{ background: "var(--hero-grad)" }}
          />
          <p className="text-white/70 mt-3">
            See how you stack up and celebrate progress with others
          </p>
        </div>

        {/* Leaderboard */}
        <Card className="soft-card rounded-[28px] overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-6 h-6 text-yellow-400" />
              Leaderboard
            </CardTitle>
            <div className="flex pt-2 items-center gap-1.5">
              {["points", "streak", "saved"].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={
                    "rounded-full px-3 py-1 text-xs border " +
                    (mode === m ? "bg-white/20 border-white/40 text-white" : "bg-white/10 border-white/20 text-white/80")
                  }
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {leaderboard.map((u, i) => (
              <div
                key={u.id || u.name}
                className="flex items-center justify-between bg-white/5 p-3 rounded-2xl border border-white/10"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {u.avatar ? (
                      <img
                        src={u.avatar}
                        alt={u.name || "User"}
                        className="w-10 h-10 rounded-full border border-white/20 object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full border border-white/20 bg-white/10 flex items-center justify-center">
                        <UserIcon className="w-5 h-5 text-white/80" />
                      </div>
                    )}
                    {i < 3 && (
                      <span className="absolute -top-2 -right-2">
                        {i === 0 && <Crown className="w-5 h-5 text-yellow-400" />}
                        {i === 1 && <Crown className="w-5 h-5 text-gray-300" />}
                        {i === 2 && <Crown className="w-5 h-5 text-amber-600" />}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="font-medium">{u.name}</p>
                    <div className="flex gap-2 text-xs text-white/70">
                      {renderMetric(u)}
                    </div>
                  </div>
                </div>
                <div className={`${pill}`}>#{i + 1}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Community stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="soft-card rounded-2xl p-4 text-center">
            <Users className="w-6 h-6 mx-auto mb-2 text-white/80" />
            <div className="text-2xl font-bold">{stats.members.toLocaleString()}</div>
            <p className="text-white/70 text-sm">Members</p>
          </Card>
          <Card className="soft-card rounded-2xl p-4 text-center">
            <Flame className="w-6 h-6 mx-auto mb-2 text-orange-400" />
            <div className="text-2xl font-bold">{stats.longest_streak_days}d</div>
            <p className="text-white/70 text-sm">Longest Streak</p>
          </Card>
          <Card className="soft-card rounded-2xl p-4 text-center">
            <DollarSign className="w-6 h-6 mx-auto mb-2 text-green-400" />
            <div className="text-2xl font-bold">€{(stats.total_money_saved ?? 0).toLocaleString()}</div>
            <p className="text-white/70 text-sm">Money Saved</p>
          </Card>
          <Card className="soft-card rounded-2xl p-4 text-center">
            <Heart className="w-6 h-6 mx-auto mb-2 text-red-400" />
            <div className="text-2xl font-bold">{(stats.life_regained_years ?? 0).toFixed(1)}y</div>
            <p className="text-white/70 text-sm">Life Regained</p>
          </Card>
        </div>

        {/* Motivation board */}
        <Card className="soft-card rounded-[28px] overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="w-6 h-6" style={{ color: "var(--hero-grad-first)" }} />
              Motivation Wall
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Post box (max 100 chars, AI-checked on server) */}
            <form onSubmit={submitMotivation} className="flex flex-col gap-2">
              <label className="text-sm text-white/80">
                Share your own motivational line (max {MAX_LEN} chars)
              </label>
              <textarea
                value={motivationText}
                onChange={(e) => setMotivationText(e.target.value.slice(0, MAX_LEN + 2))}
                rows={3}
                placeholder="e.g., Keep going — you're closer than you think!"
                className={`w-full rounded-xl border p-3 bg-white/5 border-white/10 outline-none focus:ring ${motivationText.length > MAX_LEN ? "border-red-500" : "border-white/10"
                  }`}
              />
              <div
                className={`text-xs ${motivationText.length > MAX_LEN ? "text-red-400" : "text-white/60"
                  }`}
              >
                {MAX_LEN - motivationText.length} characters left
              </div>
              {motivationErr && (
                <div className="text-sm text-red-400">{motivationErr}</div>
              )}
              <button
                type="submit"
                disabled={posting}
                className="self-start rounded-2xl px-4 py-2 shadow bg-white/20 border border-white/30 text-white disabled:opacity-60"
                style={{ background: "var(--hero-grad)", borderColor: "var(--hero-grad-first)" }}
              >
                {posting ? "Checking with AI…" : "Post to Wall"}
              </button>
            </form>

            {/* Live, approved posts */}
            {motivationItems.length === 0 ? (
              <div className="text-white/60 text-sm">No posts yet. Be the first!</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {motivationItems.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-2xl bg-white/5 border border-white/10 p-4"
                  >
                    <p className="text-white/80 italic">
                      “{m.message}”{m.authorName ? ` – ${m.authorName}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>

        </Card>
      </div>
    </div>
  );
}
