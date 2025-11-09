// src/services/dailyLogs.js
/**
 * Module: Daily logs (CRUD) & streak computation
 *
 * Purpose
 * - Store and retrieve per-day smoking data (cigs, cravings, mood, stress, notes).
 * - Keep a normalized invariant: smoke_free is true only when cigarettes_smoked === 0.
 * - Compute current streak based on quit date and most recent slip.
 *
 * Key exports
 * - getDailyLog(uid, dateIso)
 * - upsertDailyLog(uid, dateIso, data)  // merge; normalizes fields
 * - listRecentDailyLogs(uid, count?)
 * - computeStreakFromQuit(uid, quitIso, todayIso) → { current_streak_days, streak_start_date, last_slip_date }
 *
 * Data model
 * - users/{uid}/dailyLogs/{YYYY-MM-DD}: { date, cigarettes_smoked, cravings_count, mood_rating, stress_level, notes, smoke_free, createdAt, updatedAt }
 *
 * Expectations / rules
 * - Dates are ISO strings (YYYY-MM-DD), local-day semantics handled by caller.
 * - Firestore indexes: queries by date and flags may require composite indexes in production.
 */

import { db } from "@/firebase";
import {
  doc, setDoc, getDoc, serverTimestamp,
  collection, query, where, orderBy, limit, getDocs
} from "firebase/firestore";



export async function getDailyLog(uid, date) {
  const ref = doc(db, "users", uid, "dailyLogs", date);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: date, ...snap.data() } : null;
}

export async function upsertDailyLog(uid, date, data) {
  const ref = doc(db, "users", uid, "dailyLogs", date);
  

  // Normalize fields so slips are always detectable:
  const cigCount = Number(data?.cigarettes_smoked ?? 0);
  const normalized = {
    ...data,
    date,
    cigarettes_smoked: cigCount,
    // if not explicitly set, infer smoke_free from cig count
    smoke_free:
      typeof data?.smoke_free === "boolean"
        ? data.smoke_free && cigCount === 0 // guard: if cigs > 0, force false
        : cigCount === 0,
    updatedAt: serverTimestamp(),
    createdAt: data?.createdAt ?? serverTimestamp(),
  };

  await setDoc(ref, normalized, { merge: true });

  return { ok: true };
}

export async function listRecentDailyLogs(uid, count = 3) {
  const col = collection(db, "users", uid, "dailyLogs");
  const q = query(col, orderBy("date", "desc"), limit(count));
  const snap = await getDocs(q);
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  return rows;
}


export async function computeStreakFromQuit(uid, quitIso, todayIso) {
  if (!quitIso) {
    return { current_streak_days: 0, streak_start_date: null, last_slip_date: null };
  }

  const col = collection(db, "users", uid, "dailyLogs");


  // Most recent slip by explicit flag OR by cigs > 0
  const qSlip = query(
    col,
    where("smoke_free", "==", false),
    where("date", ">=", quitIso),
    where("date", "<=", todayIso),
    orderBy("date", "desc"),
    limit(1)
  );
  const qCigs = query(
    col,
    where("cigarettes_smoked", ">", 0),
    where("date", ">=", quitIso),
    where("date", "<=", todayIso),
    orderBy("date", "desc"),
    limit(1)
  );
  const [snap1, snap2] = await Promise.all([getDocs(qSlip), getDocs(qCigs)]);
  const candidates = [];
  if (!snap1.empty) candidates.push(snap1.docs[0].data().date);
  if (!snap2.empty) candidates.push(snap2.docs[0].data().date);
  candidates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // ISO desc

  const nextDay = (iso) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  let startIso;
  let lastSlipIso = candidates[0] ?? null;

  if (!lastSlipIso) {
    // No slips since quitting → streak starts at quit date
    startIso = quitIso;
  } else {
    startIso = nextDay(lastSlipIso);        // day after the most recent slip
  }

  // Days difference (clamped at 0)
  const dStart = new Date(startIso + "T00:00:00");
  const dToday = new Date(todayIso + "T00:00:00");
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.max(0, Math.floor((dToday - dStart) / msPerDay));

  return {
    current_streak_days: diffDays,
    streak_start_date: startIso,
    last_slip_date: lastSlipIso,
  };
}

