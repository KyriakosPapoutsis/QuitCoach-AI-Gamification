/**
 * DailyLog.jsx
 * -------------
 * Purpose: Daily self-report form where users log cigarettes, cravings,
 *          mood, stress, triggers, and optional notes.
 *
 * Data Flow:
 * - Firestore: users/{uid}/dailyLogs (stored per date)
 * - Uses services/dailyLogs to read, upsert, and compute streaks.
 * - Updates users/{uid} profile stats on submission.
 *
 * Features:
 * - Input fields for cigarettes smoked, cravings, mood rating, etc.
 * - Autosaves or submits updates to Firestore via upsertDailyLog().
 * - Displays daily badges or messages based on progress.
 * - Invokes evaluateAndUnlockBadges() after saving logs.
 *
 * Dev Notes:
 * - Auth-guarded: waits for onAuthStateChanged before loading user data.
 * - Uses date-fns for date formatting and streak calculation.
 * - Styled with UI components (Card, Input, Textarea, Button, Badge).
 */

import React, { useState, useEffect, Fragment, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Cigarette,
  Brain,
  Heart,
  MessageSquare,
  AlertTriangle,
  TrendingUp,
  Save,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { auth } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getDailyLog, upsertDailyLog, listRecentDailyLogs, computeStreakFromQuit } from "@/services/dailyLogs";
import { updateUserProfile } from "@/services/users";
import { db } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { evaluateAndUnlockBadges } from "@/services/badges";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
} from "recharts";
import { RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";


const TRIGGERS = [
  "Stress", "Social pressure", "After meals", "With coffee",
  "Alcohol", "Boredom", "Work break", "Driving", "Phone calls", "Habit"
];

const MOOD_PRESETS = [
  { score: 1, label: "Low" },
  { score: 2, label: "Down" },
  { score: 3, label: "Okay" },
  { score: 4, label: "Good" },
  { score: 5, label: "Great" },
];

const STRESS_PRESETS = [
  { score: 1, label: "Calm" },
  { score: 2, label: "Easy" },
  { score: 3, label: "Mid" },
  { score: 4, label: "High" },
  { score: 5, label: "Max" },
];

const moodLabel = (n) => (MOOD_PRESETS.find(m => m.score === Number(n))?.label ?? String(n));
const stressLabel = (n) => (STRESS_PRESETS.find(s => s.score === Number(n))?.label ?? String(n));

export default function DailyLogPage() {
  const [user, setUser] = useState(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [dailyLogEntry, setDailyLogEntry] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);

  const [form, setForm] = useState({
    cigarettes_smoked: 0,
    cravings_count: 0,
    mood_rating: 3,
    stress_level: 3,
    notes: "",
    triggers_faced: [],
    smoke_free: true,
  });

  const [uid, setUid] = useState(null);

  // NEW: modal visibility
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUid(fbUser?.uid || null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) return;
    loadData();
  }, [uid, selectedDate]);

  async function loadData() {
    if (!uid) return;
    setLoading(true);
    try {
      const entry = await getDailyLog(uid, selectedDate);
      if (entry) {
        setDailyLogEntry(entry);
        setForm({
          cigarettes_smoked: Number(entry.cigarettes_smoked ?? 0),
          cravings_count: Number(entry.cravings_count ?? 0),
          mood_rating: Number(entry.mood_rating ?? 3),
          stress_level: Number(entry.stress_level ?? 3),
          notes: entry.notes ?? "",
          triggers_faced: entry.triggers_faced ?? [],
          smoke_free: entry.smoke_free ?? (Number(entry.cigarettes_smoked ?? 0) === 0),
        });
      } else {
        setDailyLogEntry(null);
        setForm({
          cigarettes_smoked: 0,
          cravings_count: 0,
          mood_rating: 3,
          stress_level: 3,
          notes: "",
          triggers_faced: [],
          smoke_free: true,
        });
      }

      const last3 = await listRecentDailyLogs(uid, 3);
      setRecentLogs(last3 || []);
    } catch (e) {
      console.warn("DailyLog load error:", e);
    } finally {
      setLoading(false);
    }
  }

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const inc = (k, step = 1) => setForm(prev => ({ ...prev, [k]: Math.max(0, (prev[k] ?? 0) + step) }));
  const dec = (k, step = 1) => setForm(prev => ({ ...prev, [k]: Math.max(0, (prev[k] ?? 0) - step) }));
  const toggleTrigger = (t) => setForm(prev => ({
    ...prev,
    triggers_faced: prev.triggers_faced.includes(t)
      ? prev.triggers_faced.filter(x => x !== t)
      : [...prev.triggers_faced, t],
  }));

  async function handleSave() {
    if (!uid) return;
    setSaving(true);

    const payload = {
      smoke_free: Number(form.cigarettes_smoked || 0) === 0,
      cigarettes_smoked: Number(form.cigarettes_smoked || 0),
      cravings_count: Number(form.cravings_count || 0),
      mood_rating: Number(form.mood_rating || 0),
      stress_level: Number(form.stress_level || 0),
      notes: form.notes || "",
      triggers_faced: form.triggers_faced || [],
    };

    // Detect whether streak could be affected
    const prevSmokeFree =
      typeof dailyLogEntry?.smoke_free === "boolean" ? dailyLogEntry.smoke_free : null;
    const changedSmokeFree =
      prevSmokeFree === null ? true : prevSmokeFree !== payload.smoke_free;

    setDailyLogEntry(prev => ({ ...(prev || {}), id: prev?.id, date: selectedDate, ...payload }));
    setRecentLogs(prev => {
      const id = dailyLogEntry?.id || `${uid}-${selectedDate}`;
      const row = { id, date: selectedDate, ...payload };
      const i = prev.findIndex(x => (x.id && x.id === id) || x.date === selectedDate);
      const next = [...prev];
      if (i >= 0) next[i] = { ...next[i], ...row };
      else next.unshift(row);
      return next.slice(0, 3);
    });

    try {
      // 1) Fast write (no extra work inside)
      await upsertDailyLog(uid, selectedDate, payload);

      // 2) Background: streak recompute ONLY if smoke_free changed
      if (changedSmokeFree) {
        (async () => {
          try {
            const userSnap = await getDoc(doc(db, "users", uid));
            const quitIso = (userSnap.data()?.quit_date || "").slice(0, 10) || null;
            const todayIso = new Date().toISOString().slice(0, 10);
            const { current_streak_days, streak_start_date, last_slip_date } =
              await computeStreakFromQuit(uid, quitIso, todayIso);
            await updateUserProfile(uid, {
              current_streak_days,
              streak_start_date: streak_start_date || null,
              last_slip_date: last_slip_date || null,
            });
          } catch (e) {
            console.warn("Background streak update failed:", e);
          }
        })();
      }

      // 3) Background: badges (once, after the write)
      (async () => {
        try {
          await evaluateAndUnlockBadges(uid);
        } catch (e) {
          console.warn("Background badge eval failed:", e);
        }
      })();

    } catch (e) {
      console.warn("DailyLog save error:", e);
      // Optional fallback: loadData(); (foreground) if you want to resync after a failure
    } finally {
      setSaving(false);
    }
  }



  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 bg-[#0c0f14]">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-t-transparent animate-spin"></div>
          <p className="text-gray-300">Loading your Daily Log...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Daily Log</h1>
        <div className="mt-2 mx-auto w-40 h-[6px] rounded-full" style={{ background: "var(--hero-grad)" }} />
      </div>

      {/* Date */}
      <Card className="soft-card rounded-[22px] overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--hero-grad)" }} />
            Date
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              type="date"
              value={selectedDate}
              max={format(new Date(), "yyyy-MM-dd")}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-white border-white/20 focus-visible:ring-0 focus-visible:border-white/40 bg-white/10 rounded-xl"
            />
            <div className="flex w-full gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const day = subDays(new Date(), d);
                const key = format(day, "yyyy-MM-dd");
                const active = key === selectedDate;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    className={`flex-1 flex items-center justify-center h-8 rounded-full text-[11px] font-medium border transition ${active ? "text-white border-white/30" : "text-white/80 border-white/15 hover:border-white/30"}`}
                    style={active ? { background: "var(--hero-grad)" } : { background: "rgba(255,255,255,0.06)" }}
                  >
                    {d === 0 ? "Today" : format(day, "EEE")}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Counters */}
      <div className="grid grid-cols-2 gap-4">
        <CounterPill
          title="Cigarettes Smoked"
          icon={Cigarette}
          value={form.cigarettes_smoked}
          setValue={(v) => setField("cigarettes_smoked", v)}
          inc={() => inc("cigarettes_smoked")}
          dec={() => dec("cigarettes_smoked")}
          goodBadge="Smoke-free day!"
          showWarning={true}
        />
        <CounterPill
          title="Cravings Experienced"
          icon={Brain}
          value={form.cravings_count}
          setValue={(v) => setField("cravings_count", v)}
          inc={() => inc("cravings_count")}
          dec={() => dec("cravings_count")}
        />
      </div>

      {/* Mood & Stress */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PickerCard
          title="Mood"
          icon={Heart}
          items={MOOD_PRESETS}
          value={form.mood_rating}
          onPick={(v) => setField("mood_rating", v)}
        />
        <PickerCard
          title="Stress"
          icon={AlertTriangle}
          items={STRESS_PRESETS}
          value={form.stress_level}
          onPick={(v) => setField("stress_level", v)}
        />
      </div>

      {/* Triggers (only if smoked) */}
      {form.cigarettes_smoked > 0 && (
        <Card className="soft-card rounded-[22px] overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--hero-grad)" }} />
              <AlertTriangle className="w-5 h-5 text-white/85" />
              Triggers Faced
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-2">
              {TRIGGERS.map((t) => {
                const active = form.triggers_faced.includes(t);
                return (
                  <Badge
                    key={t}
                    onClick={() => toggleTrigger(t)}
                    className={`cursor-pointer rounded-full px-3 py-2 transition ${active
                      ? "text-white"
                      : "text-white/85 border-white/20 hover:border-white/40"}`}
                    style={active
                      ? { background: "var(--hero-grad)", borderColor: "var(--hero-grad-first)" }
                      : { background: "rgba(255,255,255,0.06)" }}
                    variant={active ? "default" : "outline"}
                  >
                    {t}
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes + Save */}
      <Card className="soft-card rounded-[22px] overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--hero-grad)" }} />
            <MessageSquare className="w-5 h-5 text-white/85" />
            Notes (optional)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <Textarea
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
            placeholder="What helped today? Any tough moments? What will you try tomorrow?"
            className="min-h-[110px] text-white border-white/20 bg-white/10 rounded-xl placeholder:text-white/50"
          />
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full h-14 rounded-full flex items-center justify-center text-white border"
            style={{ background: "var(--hero-grad)", borderColor: "var(--hero-grad-first)" }}
          >
            <Save className="w-5 h-5 mr-2" />
            {saving ? "Saving…" : dailyLogEntry ? "Update Entry" : "Save Entry"}
          </Button>
        </CardContent>
      </Card>

      {/* NEW: Button under the Notes card */}
      <div className="flex justify-center">
        <button
          onClick={() => setShowStats(true)}
          className="mt-1 inline-flex items-center gap-2 rounded-full px-4 h-10 text-sm text-white border hover:opacity-95"
          style={{ background: "var(--hero-grad)", borderColor: "var(--hero-grad-first)" }}
        >
          <FileText className="w-4 h-4" /> Last Week Report Card
        </button>
      </div>

      {/* Recent Progress */}
      {recentLogs?.length > 0 && (
        <Card className="soft-card rounded-[22px] overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--hero-grad)" }} />
              <TrendingUp className="w-5 h-5 text-white/85" />
              Recent Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-2">
              {recentLogs.map((log) => (
                <div key={log.id} className="rounded-2xl px-3 py-3 border border-white/10 bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-white/85 text-sm">{format(parseISO(log.date), "EEE, MMM d")}</span>
                      {log.smoke_free ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300 text-xs">
                          <CheckCircle2 className="w-4 h-4" />
                          Smoke-free
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-300 text-xs">
                          <Cigarette className="w-4 h-4" />
                          {log.cigarettes_smoked ?? 0} cig(s)
                        </span>
                      )}
                    </div>
                    <div className="inline-flex items-center gap-1 text-white/85">
                      <Brain className="w-4 h-4" />
                      <span className="text-sm">{log.cravings_count ?? 0}</span>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="text-white/85"><strong className="text-white">Mood:</strong> {moodLabel(log.mood_rating)}</div>
                    <div className="text-white/85"><strong className="text-white">Stress:</strong> {stressLabel(log.stress_level)}</div>
                  </div>

                  {(log.triggers_faced?.length > 0 || log.notes) && (
                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
                      {log.triggers_faced?.length > 0 && (
                        <div className="text-white/85"><strong className="text-white">Triggers:</strong> {log.triggers_faced.join(", ")}</div>
                      )}
                      {log.notes && (
                        <div className="text-white/85"><strong className="text-white">Notes:</strong> <span className="line-clamp-3">{log.notes}</span></div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* NEW: modal */}
      <LastWeekStatsModal open={showStats} onClose={() => setShowStats(false)} uid={uid} />
    </div>
  );
}

/* ---------- Last Week Stats Modal (inline) ---------- */
function LastWeekStatsModal({ open, onClose, uid }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !uid) return;
    let alive = true;
    setLoading(true);

    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      return d;
    });

    Promise.all(
      days.map(async (d) => {
        const key = d.toISOString().slice(0, 10);
        const entry = await getDailyLog(uid, key);
        return {
          dateKey: key,
          cravings: Number(entry?.cravings_count ?? 0),
          cigarettes: Number(entry?.cigarettes_smoked ?? 0),
          stress: Number(entry?.stress_level ?? 0),
          mood: Number(entry?.mood_rating ?? 0),
        };
      })
    )
      .then((data) => { if (alive) setRows(data); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [open, uid]);

  const chartData = useMemo(
    () => rows.map(r => ({
      day: r.dateKey.slice(5),
      cravings: r.cravings,
      cigarettes: r.cigarettes,
      stress: r.stress,
      mood: r.mood,
    })),
    [rows]
  );

  // ===== THEME COLORS (only your --hero-grad-first) =====
  const heroFirst =
    (typeof document !== "undefined" &&
      getComputedStyle(document.documentElement).getPropertyValue("--hero-grad-first").trim()) ||
    "#7c3aed";
  const positiveColor = heroFirst;   // Mood + Cravings
  const negativeColor = "#ff0051ff";   // Stress + Cigarettes (clear, readable)

  // ===== AXES & VISIBILITY =====
  const prefersDark = typeof window !== "undefined"
    ? window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    : true;
  const fg = prefersDark ? "rgba(255,255,255,0.92)" : "rgba(17,24,39,0.92)";
  const gridStroke = prefersDark ? "rgba(255,255,255,0.16)" : "rgba(17,24,39,0.12)";
  const tickStyle = { fill: fg, fontSize: 11 };

  // ===== BAR Y-AXIS TICKS (show from 0 upward, always visible) =====
  const { barMax, barTicks } = useMemo(() => {
    const maxVal = Math.max(
      0,
      ...chartData.map(d => Math.max(d.cravings ?? 0, d.cigarettes ?? 0))
    );
    const rawTop = Math.max(5, maxVal);      // ensure at least 0..5 shown
    const top = Math.min(50, Math.ceil(rawTop)); // cap for readability
    // tick every 1 up to 10, then every 2 up to 20, then every 5
    let step = 1;
    if (top > 10 && top <= 20) step = 2;
    else if (top > 20) step = 5;
    const ticks = [];
    for (let v = 0; v <= top; v += step) ticks.push(v);
    return { barMax: top, barTicks: ticks };
  }, [chartData]);

  // ===== WEEKLY GRADE (A+ → D+) =====
  // Simple, explainable scoring:
  // - Mood    (avg; 1..5) -> (val-1)/4
  // - Stress  (avg; 1..5) -> 1 - (val-1)/4
  // - Cravings(avg/day)   -> 1 - min(avg/10, 1)
  // - Cigarettes(avg/day) -> 1 - min(avg/5,  1)
  // Weights: Mood 0.2, Stress 0.2, Cravings 0.2, Cigarettes 0.4
  const { scorePct, grade, gaugeColor } = useMemo(() => {
    if (rows.length === 0) {
      return { scorePct: 0, grade: "D+", gaugeColor: "#ef4444" };
    }
    const n = rows.length;
    const avgMood = rows.reduce((s, r) => s + (r.mood || 0), 0) / n || 0;     // 1..5
    const avgStress = rows.reduce((s, r) => s + (r.stress || 0), 0) / n || 0; // 1..5
    const avgCrav = rows.reduce((s, r) => s + (r.cravings || 0), 0) / n || 0; // count
    const avgCigs = rows.reduce((s, r) => s + (r.cigarettes || 0), 0) / n || 0;

    const moodS = Math.max(0, Math.min(1, (avgMood - 1) / 4));
    const stressS = Math.max(0, Math.min(1, 1 - (avgStress - 1) / 4));
    const cravS = Math.max(0, 1 - Math.min(avgCrav / 10, 1));
    const cigS = Math.max(0, 1 - Math.min(avgCigs / 5, 1));

    const score = 0.2 * moodS + 0.2 * stressS + 0.2 * cravS + 0.4 * cigS;  // 0..1
    const pct = Math.round(score * 100);

    // Map to grade thresholds
    const gradeTable = [
      { g: "A+", t: 95 },
      { g: "A", t: 90 },
      { g: "A-", t: 85 },
      { g: "B+", t: 80 },
      { g: "B", t: 75 },
      { g: "B-", t: 70 },
      { g: "C+", t: 60 },
      { g: "C", t: 50 },
      { g: "C-", t: 40 },
      { g: "D+", t: 0 },
    ];
    const theGrade = gradeTable.find(x => pct >= x.t)?.g || "D+";

    // Green->Red color (based on score)
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const col = (t) => {
      const g = [0, 255, 64], r = [239, 68, 68];
      const rr = lerp(r[0], g[0], t), gg = lerp(r[1], g[1], t), bb = lerp(r[2], g[2], t);
      return `rgb(${rr},${gg},${bb})`;
    };

    return { scorePct: pct, grade: theGrade, gaugeColor: col(score) };
  }, [rows]);

  // ESC close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" onClick={onClose} />
      <div
        className="relative z-10 w-[95vw] max-w-3xl rounded-3xl p-4 shadow-2xl border glass-colored"
        style={{
          background: "rgba(255,255,255,0.10)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          borderColor: "rgba(255,255,255,0.25)",
          marginBottom: "calc(var(--app-bottom-gap, 84px) + env(safe-area-inset-bottom))",
          maxHeight:
            "calc(100vh - 40px - (var(--app-bottom-gap, 84px) + env(safe-area-inset-bottom)))",
          overflow: "auto",
        }}
      >
        <div className="flex items-center justify-between gap-4 px-1 mb-1">
          <h3 className="text-xl font-semibold">Last Week Stats</h3>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/5" aria-label="Close">✕</button>
        </div>

        <div className="rounded-2xl p-2 border bg-white/10 backdrop-blur-lg shadow-lg dark:bg-white/1 dark:border-white/20" style={{ borderColor: "rgba(255,255,255,0.22)" }}>
          <div className="space-y-3">
            {/* 1) Bar: Cravings & Cigarettes */}
            <div className="rounded-2xl p-2 border border-white/20 bg-white/3 backdrop-blur-lg shadow-lg">
              <div className="flex items-center gap-3 mb-1" style={{ color: fg, fontSize: 12, fontWeight: 600 }}>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: positiveColor }} /> Cravings</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: negativeColor }} /> Cigarettes</span>
              </div>
              <div className="h-28 w-full">
                <ResponsiveContainer>
                  <BarChart data={chartData} barSize={18} margin={{ top: 2, right: 8, left: 12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="day" tick={tickStyle} interval={0} />
                    <YAxis
                      domain={[0, barMax]}
                      ticks={barTicks}
                      tick={tickStyle}
                      width={44}                // ensure ticks always fit
                      allowDecimals={false}
                    />
                    <ReTooltip
                      contentStyle={{ background: prefersDark ? "rgba(17,17,17,0.92)" : "rgba(255,255,255,0.96)", borderRadius: 10, border: "none", color: fg, padding: 8 }}
                      labelStyle={{ color: fg }}
                      itemStyle={{ color: fg }}
                    />
                    <Bar dataKey="cravings" name="Cravings" fill={positiveColor} radius={[6, 6, 0, 0]} isAnimationActive />
                    <Bar dataKey="cigarettes" name="Cigarettes" fill={negativeColor} radius={[6, 6, 0, 0]} isAnimationActive />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 2) Mood line (full labels 1..5 mapped) */}
            <div className="rounded-2xl p-2 border border-white/20 bg-white/3 backdrop-blur-lg shadow-lg">
              <div className="flex items-center gap-2 mb-1" style={{ color: fg, fontSize: 12, fontWeight: 600 }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: positiveColor }} />
                Mood
              </div>
              <div className="h-28 w-full">
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 2, right: 8, left: 12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="day" tick={tickStyle} interval={0} />
                    <YAxis
                      domain={[1, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={tickStyle}
                      width={64} // extra room for "Great"
                      allowDecimals={false}
                      tickFormatter={(v) => MOOD_PRESETS.find(m => m.score === v)?.label ?? v}
                    />
                    <ReTooltip
                      contentStyle={{ background: prefersDark ? "rgba(17,17,17,0.92)" : "rgba(255,255,255,0.96)", borderRadius: 10, border: "none", color: fg, padding: 8 }}
                      formatter={(v) => MOOD_PRESETS.find(m => m.score === v)?.label ?? v}
                    />
                    <Line type="monotone" dataKey="mood" stroke={positiveColor} strokeWidth={2.5} dot={{ fill: positiveColor, r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 3) Stress line (full labels 1..5 mapped) */}
            <div className="rounded-2xl p-2 border border-white/20 bg-white/3 backdrop-blur-lg shadow-lg">
              <div className="flex items-center gap-2 mb-1" style={{ color: fg, fontSize: 12, fontWeight: 600 }}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: negativeColor }} />
                Stress
              </div>
              <div className="h-28 w-full">
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 2, right: 8, left: 12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="day" tick={tickStyle} interval={0} />
                    <YAxis
                      domain={[1, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={tickStyle}
                      width={64}
                      allowDecimals={false}
                      tickFormatter={(v) => STRESS_PRESETS.find(s => s.score === v)?.label ?? v}
                    />
                    <ReTooltip
                      contentStyle={{ background: prefersDark ? "rgba(17,17,17,0.92)" : "rgba(255,255,255,0.96)", borderRadius: 10, border: "none", color: fg, padding: 8 }}
                      formatter={(v) => STRESS_PRESETS.find(s => s.score === v)?.label ?? v}
                    />
                    <Line type="monotone" dataKey="stress" stroke={negativeColor} strokeWidth={2.5} dot={{ fill: negativeColor, r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 4) Weekly Grade (compact horizontal) */}
            <div className="rounded-2xl p-2 border border-white/20 bg-white/3 backdrop-blur-lg shadow-lg">
              <div className="flex items-center justify-between gap-3">
                {/* LEFT: title + description */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2" style={{ color: fg }}>
                    <span className="text-sm font-semibold">Your Weekly Grade</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-snug" style={{ color: fg }}>
                    <span className="opacity-90">
                      Based on Mood (↑), Stress (↓), Cravings (↓), Cigarettes (↓)
                    </span>
                  </div>
                </div>

                {/* RIGHT: small radial gauge with grade inside */}
                <div className="shrink-0 w-28 h-20 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart
                      data={[{ name: "score", value: scorePct }]}
                      startAngle={90}
                      endAngle={-270}
                      innerRadius="65%"
                      outerRadius="100%"
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                      <RadialBar dataKey="value" cornerRadius={18} background fill={gaugeColor} />
                    </RadialBarChart>
                  </ResponsiveContainer>

                  {/* Grade centered inside the dial */}
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="text-center leading-tight">
                      <div className="text-base font-extrabold" style={{ color: fg }}>{grade}</div>
                      <div className="text-[10px] opacity-80" style={{ color: fg }}>{scorePct}%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>


          </div>
        </div>
      </div>
    </div>
  );
}



/* ---------- Subcomponents (unchanged) ---------- */
function CounterPill({ title, icon: Icon, value, inc, dec, goodBadge = "", showWarning = false }) {
  return (
    <Card className="soft-card rounded-full overflow-visible">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-2 md:mb-3">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--hero-grad)" }} />
          {Icon && <Icon className="w-5 h-5 text-white/80" />}
          <span className="text-white font-semibold">{title}</span>
        </div>
        <div className="mx-auto grid items-center rounded-full w-full" style={{ gridTemplateColumns: "1fr 56px 1fr", height: 56, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)" }}>
          <button onClick={dec} aria-label={`Decrease ${title}`} className="relative h-full w-full text-white overflow-hidden" style={{ borderTopLeftRadius: 9999, borderBottomLeftRadius: 9999 }}>
            <span className="absolute inset-0" style={{ background: "var(--hero-grad)" }} />
            <span className="relative z-10 flex h-full w-full items-center justify-center text-base font-bold">−</span>
          </button>
          <div className="flex items-center justify-center">
            <div className="relative flex items-center justify-center text-white font-extrabold" style={{ width: 48, height: 48 }}>
              <span className="relative z-10 text-xl leading-none">{value}</span>
            </div>
          </div>
          <button onClick={inc} aria-label={`Increase ${title}`} className="relative h-full w-full text-white overflow-hidden" style={{ borderTopRightRadius: 9999, borderBottomRightRadius: 9999 }}>
            <span className="absolute inset-0" style={{ background: "var(--hero-grad)" }} />
            <span className="relative z-10 flex h-full w-full items-center justify-center text-base font-bold">+</span>
          </button>
        </div>
        {Number(value) === 0 && goodBadge ? (
          <div className="flex items-center justify-center gap-2 mt-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span className="text-emerald-200 text-xs md:text-sm">{goodBadge}</span>
          </div>
        ) : null}
        {showWarning && Number(value) > 0 && (
          <div className="flex items-center justify-center gap-2 mt-2">
            <AlertTriangle className="w-7 h-6 text-rose-300" />
            <span className="text-rose-300 text-xs md:text-sm">This will reset your smoke-free streak!</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PickerCard({ title, icon: Icon, items, value, onPick }) {
  return (
    <Card className="soft-card rounded-[22px] overflow-hidden">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--hero-grad)" }} />
          {Icon && <Icon className="w-5 h-5 text-white/85" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex flex-wrap gap-2">
          {items.map((it) => {
            const active = value === it.score;
            return (
              <button
                key={it.score}
                onClick={() => onPick(it.score)}
                className={`px-3 py-2 rounded-full text-sm border transition ${active ? "text-white border-white/30" : "text-white/80 border-white/15 hover:border-white/30"}`}
                style={active ? { background: "var(--hero-grad)" } : { background: "rgba(255,255,255,0.06)" }}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* Hide scrollbar utility */
const style = document.createElement("style");
style.innerHTML = `
  .no-scrollbar::-webkit-scrollbar{ display:none; }
  .no-scrollbar{ -ms-overflow-style:none; scrollbar-width:none; }
  .line-clamp-3 { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
`;
if (typeof document !== "undefined" && !document.getElementById("no-scrollbar-style")) {
  style.id = "no-scrollbar-style";
  document.head.appendChild(style);
}
