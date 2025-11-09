/**
 * Dashboard.jsx
 * --------------
 * Purpose: Main user dashboard showing quit progress, streaks, savings, and
 *          motivational insights. Serves as the home screen after sign-in.
 *
 * Data Sources:
 * - Firestore:
 *   • users/{uid} (profile data, quit date, stats)
 *   • Challenge (daily challenges, used for completion stats)
 *   • users/{uid}/badges (unlocks & milestone tracking)
 * - Local helpers: date-based calculations for streaks, money saved,
 *   and health time regained.
 *
 * Features:
 * - Displays live quit stats, savings, life regained, and badges earned.
 * - Uses InkHeroCanvas for animated visual at the top.
 * - Links to key sections: Daily Log, Challenges, AI Coach, Audio, Profile.
 * - Includes motivational quotes and progress indicators.
 *
 * Dev Notes:
 * - React hooks for live auth/user tracking.
 * - Recomputes metrics dynamically from quit_date and challenge data.
 * - Uses evaluateAndUnlockBadges() to refresh achievements.
 */

import React, { useState, useEffect } from "react";
import { Challenge } from "@/entities/Challenge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Heart,
  Target,
  Cigarette,
  DollarSign,
  Trophy,
  Bell,
  User as UserIcon,
  Settings,
  BarChart3,
  MessageCircle,
  Music,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, differenceInDays, startOfDay } from "date-fns";
import InkHeroCanvas from "@/components/InkHeroCanvas";
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot, collection, query, orderBy, limit } from "firebase/firestore";
import { updateUserProfile } from "@/services/users"; // Firestore saver
import { CheckCircle2, XCircle, Calendar as CalendarIcon } from "lucide-react";
import { formatRegained } from "@/utils/formatters";
import { ensureUserDocument } from "@/services/users";
import { BADGE_META, getUnlockedBadges, evaluateAndUnlockBadges } from "@/services/badges";
import { observeUnreadCount } from "@/services/notifications";
import { getAuth } from "firebase/auth";
import axios from "axios";


function InfoButton({ title, url, gradientId = "hring-gradient" }) {
  return (
    <button
      aria-label={title || "More info"}
      title={title}
      onClick={() => url && window.open(url, "_blank", "noopener")}
      className="relative w-7 h-7 rounded-full bg-white/5 border border-white/15 backdrop-blur-md hover:bg-white/10 transition flex items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {/* match your progress bar theme */}
            <stop offset="0%" stopColor="#ffffffff" />
            <stop offset="100%" stopColor="#8e8e8eff" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="9.5" fill="none" stroke={`url(#${gradientId})`} strokeWidth="2.5" />
      </svg>
      <span className="relative text-[16px] font-semibold leading-none text-white/90">i</span>
    </button>
  );
}

const LIFE_INFO_SOURCE = {
  org: 'BMJ',
  title: 'Using "microlives" to communicate lifetime risk (2012)',
  url: 'https://www.bmj.com/content/345/bmj.e8223',
};


const MOOD_WORD = { 1: "Low", 2: "Down", 3: "Okay", 4: "Good", 5: "Great" };
const STRESS_WORD = { 1: "Calm", 2: "Easy", 3: "Mid", 4: "High", 5: "Max" };
const moodWord = (n) => MOOD_WORD[Number(n)] ?? String(n ?? "-");
const stressWord = (n) => STRESS_WORD[Number(n)] ?? String(n ?? "-");


const allBadges = [
  { id: "streak1", title: "100-Day Streak", src: "/badges/badge100.png", unlocked: false },
  { id: "streak5", title: "3-Day Streak", src: "/badges/badge3.png", unlocked: true },
  { id: "leader", title: "Reach Top 2", src: "/badges/badgeLeaderboard2.png", unlocked: true },
  { id: "ai1", title: "First AI Coach Message", src: "/badges/badgeAI.png", unlocked: false },
  { id: "streak200", title: "200-Day Streak", src: "/badges/badge200.png", unlocked: false },
  { id: "health", title: "Health Improving", src: "/badges/badgeHealth.png", unlocked: false },
];

// Dashboard.jsx
const HEALTH_STAGES = [
  {
    id: "day0_20min", start: 0, next: 1,
    text: "Heart rate and blood pressure start to drop within 20 minutes."
  },
  {
    id: "day0_8h", start: 0, next: 1,
    text: "Oxygen levels recover; carbon monoxide has fallen by about half."
  },
  {
    id: "day1_12_24h", start: 1, next: 2,
    text: "Carbon monoxide returns to normal (~12h); nicotine levels drop to zero by 24h."
  },
  {
    id: "day2_48h", start: 2, next: 3,
    text: "Taste and smell begin improving as lungs clear mucus."
  },
  {
    id: "day3_72h", start: 3, next: 14,
    text: "Breathing feels easier as airways relax; energy can rise."
  },
  {
    id: "wk2_to_wk12", start: 14, next: 90,
    text: "Circulation improves; lung function begins to increase."
  },
  {
    id: "mo1", start: 30, next: 90,
    text: "Cilia recover; airways clear mucus better; infection risk drops."
  },
  {
    id: "mo3", start: 90, next: 180,
    text: "Coughing and breathlessness keep improving; lung function trending up."
  },
  {
    id: "mo6", start: 180, next: 270,
    text: "Many people cough less and bring up less phlegm as lungs heal (months 1–9)."
  },
  {
    id: "mo9", start: 270, next: 365,
    text: "Lung function may be ~10% higher than at quit; breathlessness eases."
  },
  {
    id: "1year", start: 365, next: 730,
    text: "Risk of coronary heart disease is about half that of someone who smokes."
  },
  {
    id: "1_to_2_years", start: 365, next: 1095,
    text: "Risk of heart attack drops sharply within 1–2 years after quitting."
  },
  {
    id: "3_to_6_years", start: 1095, next: 2190,
    text: "Added risk of coronary heart disease drops by about half by 3–6 years."
  },
  {
    id: "5_to_10_years", start: 2190, next: 3650,
    text: "Risk of stroke decreases; mouth/throat/larynx cancer risk is cut about in half."
  },
  {
    id: "10years", start: 3650, next: 5475,
    text: "Risk of dying from lung cancer is about half that of a current smoker."
  },
  {
    id: "15years", start: 5475, next: 5475,
    text: "Risk of coronary heart disease approaches that of a nonsmoker."
  },
];

function getHealthUI(days) {
  let cur = HEALTH_STAGES[0];
  for (const s of HEALTH_STAGES) if (days >= s.start) cur = s;
  const start = cur.start;
  const end = Math.max(cur.next, start + 1); // avoid divide-by-zero
  const pct = days >= end ? 100 : Math.round(((days - start) / (end - start)) * 100);
  return { id: cur.id, text: cur.text, percent: Math.max(0, Math.min(100, pct)) };
}


// Life regained (progress toward meaningful hour buckets)
// We already compute hours via: hoursRegained = floor((cigarettesAvoided*11)/60)
const LIFE_STEPS = [
  { id: "h0", minHours: 0 },
  { id: "h24", minHours: 24 },
  { id: "h72", minHours: 72 },
  { id: "h168", minHours: 168 },
  { id: "h720", minHours: 720 },
  { id: "h2160", minHours: 2160 },
];

function HealthRecoveryCard() {
  const tidy = (s) => {
    if (!s) return s;
    s = String(s).trim();
    if (!s) return s;
    s = s[0].toUpperCase() + s.slice(1);
    return /[.!?]$/.test(s) ? s : s + ".";
  };
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null); // {progressPct, phrase, fact, source, stage, phrases}

  useEffect(() => {
    let timer;
    const fetchIt = async () => {
      setLoading(true);
      try {
        const token = await getAuth().currentUser?.getIdToken?.();
        const r = await axios.get(`${import.meta.env.VITE_API_BASE}/ai/health-recovery`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setData(r.data);
      } catch (e) {
        console.warn("health-recovery fetch failed:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchIt();

    // Rotate phrase on the hour (no extra API call—just re-pick by hour)
    timer = setInterval(() => {
      setData((prev) => {
        if (!prev?.phrases?.length) return prev;
        const idx = new Date().getHours() % prev.phrases.length;
        return { ...prev, phrase: prev.phrases[idx] };
      });
    }, 60 * 1000); // wake up every minute; index uses current hour

    return () => clearInterval(timer);
  }, []);

  if (loading) return <Card>Loading Health recovery…</Card>;
  if (!data) return null;

  return (
    <Card className="soft-card rounded-[28px] md:rounded-[36px] overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-white/90" aria-hidden="true" />
            <span>Health recovery</span>
          </span>

          {/* Glassy info button (themed ring, subtle glass bg) */}
          <InfoButton
            title={`${data.source?.org}: ${data.source?.title}`}
            url={data.source?.url}
            gradientId="hring-health"
          />

        </CardTitle>
      </CardHeader>

      <CardContent>
        <p className="text-white/80 text-sm">{tidy(data.phrase)}</p>

        <div className="mt-3">
          <Progress
            value={data.progressPct}
            barClassName="progress-hero-gradient"
            className="h-2 bg-white/10 rounded-full"
          />
          <div className="mt-2 text-xs text-white/60">
            Current level: {data.stage?.label} •  {data.progressPct}% to next milestone
          </div>
        </div>
      </CardContent>
    </Card>
  );

}

function getLifeUI(hours) {
  let current = LIFE_STEPS[0];
  for (const s of LIFE_STEPS) if (hours >= s.minHours) current = s;
  const currentIdx = LIFE_STEPS.findIndex(s => s.id === current.id);
  const next = LIFE_STEPS[currentIdx + 1];

  // progress toward NEXT life milestone
  const start = current.minHours;
  const end = next ? next.minHours : Math.max(start + 1, hours);
  const pct = Math.min(100, Math.floor(((hours - start) / (end - start)) * 100));

  const nextLabel = next ? `Next: ${next.label}` : "Milestone maxed — amazing!";
  return {
    id: current.id,
    text: current.label,
    nextText: nextLabel,
    percent: pct,
  };
}

function BellWithBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let stopUnread = () => { };
    // Re-subscribe whenever auth state changes
    const stopAuth = onAuthStateChanged(auth, (u) => {
      // tear down previous subscription
      try { stopUnread(); } catch { }
      if (u) {
        stopUnread = observeUnreadCount(setCount); // listens to users/{uid}/notifications where read==false
      } else {
        setCount(0);
        stopUnread = () => { };
      }
    });

    return () => {
      try { stopUnread(); } catch { }
      try { stopAuth(); } catch { }
    };
  }, []);

  return (
    <div className="relative">
      <Bell className="w-6 h-6" />
      {count > 0 && (
        <span
          className="absolute -top-2 -right-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-rose-600 leading-none pointer-events-none shadow-sm"
        >
          {count}
        </span>
      )
      }
    </div >
  );
}



function getRecentBadges(allBadges = []) {

  const unlocked = allBadges.filter(b => b.unlocked);
  return unlocked.slice(-2).reverse();
}


export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [todayLog, setTodayLog] = useState(null);
  const [todayChallenges, setTodayChallenges] = useState([]);
  const [loading, setLoading] = useState(true);


  const [recentBadges, setRecentBadges] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const heroName =
    user?.displayName ||
    user?.full_name ||
    user?.username ||
    (user?.email?.split("@")[0]) ||
    "You";

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;  // don’t run if signed out

    if (!uid) { setLoadingRecent(false); return; }
    // best-effort catch-up (background)
    evaluateAndUnlockBadges(uid).catch(() => { });

    const colRef = collection(db, "users", uid, "badges");
    const qRef = query(colRef, orderBy("unlockedAt", "desc"), limit(2));
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const items = [];
        snap.forEach((d) => {
          const meta = BADGE_META[d.id];
          if (meta?.title && meta?.src) items.push({ id: d.id, ...meta });
        });
        setRecentBadges(items);
        setLoadingRecent(false);
      },
      (err) => {
        console.error("Recent badges subscribe failed:", err);
        setLoadingRecent(false);
      }
    );
    return () => unsub();

  }, []);

  // track current time so we can flip from countdown → smoke-free at midnight
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000); // update every minute
    return () => clearInterval(id);
  }, []);

  // a stable key that changes once per calendar day in local time
  const dayKey = format(now, "yyyy-MM-dd");


  useEffect(() => {
    if (!user?.id) return;


    const todayIso = format(now, "yyyy-MM-dd");
    const ref = doc(db, "users", user.id, "dailyLogs", todayIso);


    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setTodayLog({ id: snap.id, ...snap.data() });
        } else {
          setTodayLog(null);
        }
      },
      (err) => {
        if (err?.code === "permission-denied" || err?.code === "unauthenticated") return;
        console.error("onSnapshot error:", err);
      }
    );

    return () => unsub();
  }, [user?.id, now]);

  const getRecentBadges = (allBadges = []) => {
    const unlocked = allBadges.filter(b => b.unlocked);
    return unlocked.slice(-2).reverse();
  };




  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      try {
        if (!fbUser) {
          navigate(createPageUrl("SignIn"));
          return;
        }
        // ensure the users/{uid} doc exists for brand-new accounts
        await ensureUserDocument(fbUser.uid);
        const userRef = doc(db, "users", fbUser.uid);

        // initial fetch
        const firstSnap = await getDoc(userRef);
        const firstData = firstSnap.exists() ? firstSnap.data() : {};
        const seed = {
          id: fbUser.uid,
          email: fbUser.email || firstData.email || "",
          username: firstData.username || "",
          full_name: firstData.displayName || firstData.username || fbUser.displayName || (fbUser.email?.split("@")[0]) || "You", profile_setup: firstData.profile_setup ?? false,
          quit_date: firstData.quit_date || "",
          target_quit_date: firstData.target_quit_date || "",
          date_mode: firstData.date_mode || "quit",
          cigarettes_per_day_before: Number(firstData.cigarettes_per_day_before || 0),
          cost_per_pack: Number(firstData.cost_per_pack || 0),
          cigarettes_per_pack: Number(firstData.cigarettes_per_pack || 20),

          // streak-related fields
          current_streak_days: Number(firstData.current_streak_days || 0),
          streak_start_date: firstData.streak_start_date || "",
          last_slip_date: firstData.last_slip_date || null,
          ...firstData,
        };
        setUser(seed);

        // load page data that depends on user id (you can keep your existing code)
        const today = format(new Date(), "yyyy-MM-dd");

        const challenges = await Challenge.filter({ user_id: seed.id, date: today });
        setTodayChallenges(challenges || []);

        // live updates (will refresh streak fields without reload)
        const unsubUser = onSnapshot(userRef, (snap) => {
          const data = snap.exists() ? snap.data() : {};
          setUser((prev) => ({
            ...prev,
            ...data,
            // ensure we keep numbers as numbers
            cigarettes_per_day_before: Number(data.cigarettes_per_day_before ?? prev.cigarettes_per_day_before ?? 0),
            cost_per_pack: Number(data.cost_per_pack ?? prev.cost_per_pack ?? 0),
            cigarettes_per_pack: Number(data.cigarettes_per_pack ?? prev.cigarettes_per_pack ?? 20),
            current_streak_days: Number(data.current_streak_days ?? 0),
          }));
        }, (err) => {
          if (err?.code === "permission-denied" || err?.code === "unauthenticated") return;
          console.error("onSnapshot error:", err);
        });

        setLoading(false);
        // cleanup the user snapshot when auth changes/unmounts
        return () => unsubUser();
      } catch (e) {
        console.error("Error loading dashboard data:", e);
        setLoading(false);
      }
    });

    return () => unsubAuth();
  }, [navigate]);


  const getQuitMode = () => {
    if (!user) return { mode: "unknown" };

    const today = startOfDay(now);
    const quit = user?.quit_date ? startOfDay(new Date(user.quit_date)) : null;
    const target = user?.target_quit_date ? startOfDay(new Date(user.target_quit_date)) : null;
    const streakStart = user?.streak_start_date ? startOfDay(new Date(user.streak_start_date)) : null;

    // If target mode is preferred and target is in the future → countdown
    if (user?.date_mode === "target" && target && target > today) {
      const daysUntil = differenceInDays(target, today);
      return { mode: "countdown", targetDate: target, daysUntil };
    }

    // Primary source of truth for "since" mode is streak_start_date (set/cleared by DailyLog saves)
    if (streakStart) {
      return { mode: "since", sinceDate: streakStart };
    }

    // Fallbacks if streak_start_date isn't present (e.g., before first daily log)
    if (quit && quit <= today) {
      return { mode: "since", sinceDate: quit };
    }
    if (target && target <= today) {
      return { mode: "since", sinceDate: target };
    }
    if (target && target > today) {
      const daysUntil = differenceInDays(target, today);
      return { mode: "countdown", targetDate: target, daysUntil };
    }

    return { mode: "unknown" };
  };



  const calculateStats = () => {

    const modeInfo = getQuitMode();
    if (modeInfo.mode === "unknown") return null;

    if (modeInfo.mode === "countdown") {
      return {
        mode: "countdown",
        daysUntil: modeInfo.daysUntil,
        daysSinceQuit: 0,
        cigarettesAvoided: 0,
        moneySaved: "0.00",
        hoursRegained: 0,
      };
    }

    // Prefer server-authoritative streak; fall back to date math if missing
    const streakDaysFromDB = typeof user?.current_streak_days === "number" ? user.current_streak_days : null;
    const daysSinceQuit = streakDaysFromDB ?? Math.max(0, differenceInDays(startOfDay(now), modeInfo.sinceDate));

    const cigsPerDay = Number(user?.cigarettes_per_day_before || 0);
    const perPack = Number(user?.cigarettes_per_pack || 20);
    const costPerPack = Number(user?.cost_per_pack || 0);

    const cigarettesAvoided = daysSinceQuit * cigsPerDay;
    const packsSaved = perPack > 0 ? (cigarettesAvoided / perPack) : 0;
    const moneySaved = packsSaved * costPerPack;

    return {
      mode: "since",
      daysSinceQuit,
      cigarettesAvoided,
      moneySaved: moneySaved.toFixed(2),
      hoursRegained: Math.floor((cigarettesAvoided * 15) / 60),
    };
  };


  // Keep current_streak_days in sync once per calendar day,
  // but ONLY when we have an authoritative streak_start_date (set by daily log processing).
  useEffect(() => {
    if (!user?.id || !user?.streak_start_date) return;
    const since = startOfDay(new Date(user.streak_start_date));
    const today = startOfDay(now);
    const days = Math.max(0, differenceInDays(today, since));
    if (typeof user.current_streak_days !== "number" || user.current_streak_days !== days) {
      (async () => {
        try {
          await ensureUserDocument(user.id);
          await updateUserProfile(user.id, { current_streak_days: days });
        } catch (e) {
          console.error("Failed to persist current_streak_days:", e);
        }
      })();
    }
  }, [dayKey, now, user?.id, user?.streak_start_date, user?.current_streak_days]);



  const stats = calculateStats() || { daysSinceQuit: 0, cigarettesAvoided: 0, moneySaved: "0.00", hoursRegained: 0 };
  const completedChallenges = todayChallenges.filter((c) => c.completed).length;
  const days = stats?.daysSinceQuit ?? 0;
  const hours = stats?.hoursRegained ?? 0;
  const healthUI = getHealthUI(days);



  // Persist to Firestore only when something changes
  useEffect(() => {
    if (!user || !user.id || !stats) return;

    const shouldUpdate =
      user.health_stage_id !== healthUI.id ||
      user.life_hours_regained !== hours ||
      user.health_stage_text !== healthUI.text;

    if (!shouldUpdate) return;

    (async () => {
      try {
        await ensureUserDocument(user.id); // safe if doc didn’t exist yet

        await updateUserProfile(user.id, {
          health_stage_id: healthUI.id,
          health_stage_text: healthUI.text,
          health_stage_percent: healthUI.percent,
          life_hours_regained: hours,
        });
      } catch (e) {
        console.error("Failed to persist health progress:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, healthUI.id, healthUI.text, healthUI.percent, hours]);



  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 bg-[#0c0f14]">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-t-transparent animate-spin"></div>
          <p className="text-gray-300">Loading your Dashboard...</p>
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



  return (
    <div className="bg-[#0c0f14] min-h-screen text-white">
      {/* Page-local styles */}
      <style>{`
        .hero-wrap {
          position: relative;
          overflow: hidden;
          border-bottom-left-radius: 1.5rem;
          border-bottom-right-radius: 1.5rem;
          background: linear-gradient(145deg, #6e34f5 0%, #9a3df2 40%, #ff7b3d 100%);
        }
        .hero-inner { position: relative; z-index: 1; }

        .kicker { color: rgba(255,255,255,.9); font-size: 12px; letter-spacing:.08em; text-transform: uppercase; }

        /* Cards below hero: soft glassy look on dark */
        .soft-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
      `}</style>

      {/* HERO with animated canvas */}
      <section className="hero-wrap mb-6">
        <InkHeroCanvas />
        <div className="hero-inner px-4 pt-7 pb-13">
          {/* top row: title + actions */}
          <div className="flex items-center justify-between">
            <div>
              <div className="kicker">Your progress</div>
              <h1 className="text-[22px] font-semibold">{heroName}</h1>
            </div>
            <div className="flex gap-2">
              <div className="flex gap-2">
                <Link to={createPageUrl("Notifications")}>
                  <button className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-sm">
                    <BellWithBadge />
                  </button>
                </Link>
                <Link to={createPageUrl("Profile")}>
                  <button className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-sm">
                    <UserIcon className="w-5 h-5" />
                  </button>
                </Link>
              </div>
            </div>
          </div>

          {/* BIG NUMBERS */}
          <div className="mt-5 grid grid-cols-2 gap-3 items-end">
            <div>
              <div className="text-white/85 text-sm mb-1">
                {stats?.mode === "countdown" ? "Days until quit" : "Days smoke-free"}
              </div>
              <div className="text-4xl md:text-5xl font-extrabold tracking-tight">
                {stats?.mode === "countdown"
                  ? stats.daysUntil
                  : (typeof user?.current_streak_days === "number"
                    ? user.current_streak_days
                    : stats?.daysSinceQuit)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-white/85 text-sm mb-1">Saved</div>
              <div className="text-4xl md:text-5xl font-extrabold tracking-tight">
                €{stats?.moneySaved}
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* CONTENT BELOW HERO */}
      <div className="p-4 space-y-6">
        {/* Health recovery (AI + verified source) */}
        <HealthRecoveryCard />

        {/* Today: status */}
        <Card className="soft-card rounded-[28px] md:rounded-[36px] overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Today’s Status
              </span>
              <Link to={createPageUrl("DailyLog")}>
                <Button size="sm" variant="ghost" className="text-white/80 hover:text-white">
                  Log →
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayLog ? (
              <div className="space-y-2 text-sm">
                {/* Date */}
                <div className="flex items-center gap-2 text-white/80">
                  <CalendarIcon className="w-4 h-4" />
                  <span>{format(now, "EEE, MMM d")}</span>
                </div>

                {/* Smoke-free */}
                <div className="flex justify-between items-center">
                  <span className="text-white/80">Smoke-free:</span>
                  {todayLog.smoke_free ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="w-4 h-4" />
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-rose-300">
                      <XCircle className="w-4 h-4" />
                      No
                    </span>
                  )}
                </div>

                {/* Cigarettes smoked */}
                <div className="flex justify-between items-center">
                  <span className="text-white/80">Cigarettes smoked:</span>
                  <span className="text-white">{todayLog.cigarettes_smoked ?? 0}</span>
                </div>

                {/* Cravings */}
                <div className="flex justify-between items-center">
                  <span className="text-white/80">Cravings:</span>
                  <span className="text-white">{todayLog.cravings_count ?? "-"}</span>
                </div>

                {/* Mood (word) */}
                <div className="flex justify-between items-center">
                  <span className="text-white/80">Mood:</span>
                  <span className="text-white">{moodWord(todayLog.mood_rating)}</span>
                </div>

                {/* Stress (word) */}
                <div className="flex justify-between items-center">
                  <span className="text-white/80">Stress:</span>
                  <span className="text-white">{stressWord(todayLog.stress_level)}</span>
                </div>

                {/* Notes (only if present) */}
                {todayLog.notes ? (
                  <div className="pt-1">
                    <div className="text-white/80 mb-1">Notes:</div>
                    <p className="text-white/90 text-sm">{todayLog.notes}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-white/60 text-sm">No log entry for today yet</p>
            )}
          </CardContent>

        </Card>


        {/* Daily challenges */}
        <Card className="soft-card rounded-[28px] md:rounded-[36px] overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Daily challenges
              </span>
              <Link to={createPageUrl("Challenges")}>
                <Button size="sm" variant="ghost" className="text-white/80 hover:text-white">View →</Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/80 text-sm">Progress:</span>
              <span className="text-white font-medium">
                {completedChallenges}/{todayChallenges.length}
              </span>
            </div>
            {todayChallenges.length > 0 ? (
              <Progress
                value={(completedChallenges / todayChallenges.length) * 100}
                className="h-2 bg-white/10 rounded-full"
                barClassName="progress-hero-gradient"
              />
            ) : (

              <p className="text-white/60 text-sm">No challenges generated yet</p>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-4">
          <Link to={createPageUrl("AIChat")} className="block">
            <div className="rounded-[28px] md:rounded-[36px] overflow-hidden p-4 text-center bg-white/10 border border-white/20 hover:bg-white/15 transition">
              <MessageCircle className="w-7 h-7 mx-auto mb-2 text-white/90" />
              <h3 className="font-medium mb-1">AI Coach</h3>
              <p className="text-white/70 text-xs">Get support & tips</p>
            </div>
          </Link>
          <Link to={createPageUrl("Audio")} className="block">
            <div className="rounded-[28px] md:rounded-[36px] overflow-hidden p-4 text-center bg-white/10 border border-white/20 hover:bg-white/15 transition">
              <Music className="w-7 h-7 mx-auto mb-2 text-white/90" />
              <h3 className="font-medium mb-1">Hypnosis</h3>
              <p className="text-white/70 text-xs">Reduce cravings</p>
            </div>
          </Link>
        </div>

        {/* Extra stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-[28px] md:rounded-[36px] overflow-hidden p-4 text-center">
            <Cigarette className="w-6 h-6 mx-auto mb-2 text-white/70" />
            <div className="text-xl font-bold">{stats.cigarettesAvoided}</div>
            <p className="text-white/70 text-xs">Cigarettes avoided</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-[28px] md:rounded-[36px] overflow-hidden p-4 text-center relative">
            {/* same “i” button as HealthRecoveryCard */}
            <div className="absolute top-2 right-2">
              <InfoButton
                title={`${LIFE_INFO_SOURCE.org}: ${LIFE_INFO_SOURCE.title}`}
                url={LIFE_INFO_SOURCE.url}
                gradientId="hring-life"
              />
            </div>

            <Heart className="w-6 h-6 mx-auto mb-2 text-red-400" />
            <div className="text-xl font-bold">{formatRegained(stats.hoursRegained)}</div>
            <p className="text-white/70 text-xs">Life regained</p>
          </div>

        </div>

        {/* Recent Achievements (2 most recent badges) */}
        <Card className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">Recent Achievements</CardTitle>
          </CardHeader>

          <section className="px-6 pb-5">
            {loadingRecent ? (
              // Skeleton: 2 cells side-by-side
              <ul className="flex flex-col gap-4">
                {[0, 1].map(i => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="h-20 w-20 rounded-full bg-white/5 border border-white/10 animate-pulse" />
                    <div className="flex-1 min-w-0">
                      <div className="h-4 w-40 rounded bg-white/5 border border-white/10 animate-pulse" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : recentBadges.length ? (
              <ul className="flex flex-col gap-4">
                {recentBadges.map(b => (
                  <li key={b.id} className="flex items-center gap-3 max-w-full">
                    <div
                      className="h-20 w-20 rounded-full bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0"
                      title={b.title}
                    >
                      <img src={b.src} alt={b.title} className="h-20 w-20 object-contain" />
                    </div>
                    <span className="flex-1 min-w-0 text-sm md:text-base text-white/90 font-medium whitespace-normal break-words">
                      {b.title}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-white/60">No recent badges yet.</div>
            )}
          </section>
        </Card>
      </div>
    </div>
  );
}
