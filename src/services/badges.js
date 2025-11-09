// src/services/badges.js
/**
 * Module: Badge evaluation & unlocking
 *
 * Purpose
 * - Central place to define badge metadata and evaluate unlock conditions.
 * - Idempotently unlocks badges, persists them under users/{uid}/badges, and
 *   notifies the user (Firestore notification + optional push, if native).
 *
 * Key exports
 * - BADGE_META: catalog of badge id → {title, src, description}.
 * - getUnlockedBadges(uid, limitN?)
 * - isUnlocked(uid, badgeId)
 * - markBadgeSeen(uid, badgeId)
 * - unlock(uid, badgeId): transactional, idempotent.
 * - evaluateAndUnlockBadges(uid): computes metrics and unlocks any newly met badges.
 *
 * Data model
 * - users/{uid}/badges/{badgeId}: { unlockedAt: TS, seen: bool, seenAt?: TS }
 * - leaderboard/{uid}: { points, streak, saved, lifeYears, ... } (read-only here).
 *
 * External effects
 * - Writes to Firestore (users/{uid}/badges, users/{uid}/notifications).
 * - Optionally calls server endpoints for push dispatch (notifyBadgeUnlocked).
 *
 * Expectations / rules
 * - Requires an authenticated user (uid must match getAuth().currentUser.uid).
 * - Firestore security rules must allow the reads used for metrics aggregation.
 *
 * Notes
 * - Uses transactions and a per-session in-flight set to avoid duplicate unlocks.
 * - Streak/savings calculated from daily logs + profile; keep those up-to-date.
 */

import { db } from "@/firebase";
import {
    doc, setDoc, getDoc, getDocs, collection, query, orderBy, limit,
    serverTimestamp, where, runTransaction
} from "firebase/firestore";
import { computeStreakFromQuit } from "@/services/dailyLogs";
import { getUserProfile } from "@/services/users";
import { getAuth } from "firebase/auth";
import { notifyBadgeUnlocked } from "@/services/notifications";
import { createAndPushNotification } from "@/services/notifications";

// Prevent duplicate unlock attempts for the same badge within this session
const inFlightUnlocks = new Set();


// ---- Badge catalog (metadata) ----------------------------------------------
export const BADGE_META = {
    // Streaks (days smoke-free)
    streak1: { title: "1-Day Streak", src: "/badges/badge1.png", description: "Your first full day smoke-free. A small step that changes everything." },
    streak2: { title: "2-Day Streak", src: "/badges/badge2.png", description: "Momentum is building—two days of consistent progress." },
    streak3: { title: "3-Day Streak", src: "/badges/badge3.png", description: "Cravings come and go. You stayed steady for three days—nice work." },
    streak5: { title: "5-Day Streak", src: "/badges/badge5.png", description: "Five days! Your body is already thanking you and your confidence shows." },
    streak10: { title: "10-Day Streak", src: "/badges/badge10.png", description: "Double digits. You’re proving to yourself that this is possible." },
    streak20: { title: "20-Day Streak", src: "/badges/badge20.png", description: "Three weeks of wins. Fewer triggers, more control." },
    streak30: { title: "30-Day Streak", src: "/badges/badge30.png", description: "One month smoke-free. Your new normal is taking shape." },
    streak50: { title: "50-Day Streak", src: "/badges/badge50.png", description: "Fifty days of choosing you over urges—serious consistency." },
    streak75: { title: "75-Day Streak", src: "/badges/badge75.png", description: "Seventy-five days! You’ve built a strong, resilient habit loop." },
    streak100: { title: "100-Day Streak", src: "/badges/badge100.png", description: "100 days—triple digits! You’ve come a long way, keep cruising." },
    streak200: { title: "200-Day Streak", src: "/badges/badge200.png", description: "Two hundred days. Your health, energy, and focus are getting dividends." },
    streak365: { title: "365-Day Streak", src: "/badges/badge365.png", description: "One year smoke-free. A milestone worth celebrating big." },
    streak500: { title: "500-Day Streak", src: "/badges/badge500.png", description: "Five hundred days of commitment. You’re an inspiration." },
    streak600: { title: "600-Day Streak", src: "/badges/badge600.png", description: "Six hundred days. Deep roots, steady growth—remarkable." },
    streak700: { title: "700-Day Streak", src: "/badges/badge700.png", description: "Seven hundred days. You’ve rewritten your story." },
    streak800: { title: "800-Day Streak", src: "/badges/badge800.png", description: "Eight hundred days—your consistency is elite." },
    streak900: { title: "900-Day Streak", src: "/badges/badge900.png", description: "Nine hundred days. Nearly a thousand—and still going strong." },
    streak1000: { title: "1000-Day Streak", src: "/badges/badge1000.png", description: "A thousand days. A legacy milestone and a powerful example." },

    // Daily log milestones
    log: { title: "Make 10 Daily Logs", src: "/badges/badgeLog.png", description: "Ten check-ins completed. Tracking is how progress compounds." },
    log2: { title: "Make 30 Daily Logs", src: "/badges/badgeLog2.png", description: "Thirty reflections—clear patterns, better decisions." },
    log3: { title: "Make 100 Daily Logs", src: "/badges/badgeLog3.png", description: "One hundred logs. Your data tells a story of growth." },

    // AI coach messages
    ai1: { title: "10 AI Coach Messages", src: "/badges/badgeAI.png", description: "You’ve asked for help 10 times. Reaching out is a strength." },
    ai2: { title: "30 AI Coach Messages", src: "/badges/badgeAI2.png", description: "30 conversations with your coach—reflective and proactive." },
    ai3: { title: "100 AI Coach Messages", src: "/badges/badgeAI3.png", description: "100 coaching messages—consistent support and learning." },

    // Hypnosis listens (Audio)
    hypnosis1: { title: "Listen to 2 Hypnosis Sessions", src: "/badges/badgeHypnosis.png", description: "Two guided sessions completed—reset, relax, rewire." },
    hypnosis2: { title: "Listen to 6 Hypnosis Sessions", src: "/badges/badgeHypnosis2.png", description: "Six listens—deeper calm, easier cravings, steadier days." },
    hypnosis3: { title: "Listen to 10 Hypnosis Sessions", src: "/badges/badgeHypnosis3.png", description: "Ten sessions. You’re making calm a practice." },

    // Savings milestones (€)
    saving: { title: "€100 Saved", src: "/badges/badgeMoney.png", description: "You’ve already saved €100 by staying smoke-free." },
    saving2: { title: "€500 Saved", src: "/badges/badgeMoney2.png", description: "€500 saved—your wallet and future self are smiling." },
    saving3: { title: "€1000 Saved", src: "/badges/badgeMoney3.png", description: "€1000 saved. That’s real freedom you’ve created." },

    // Welcome (first login/setup)
    welcome: { title: "Welcome to the Club", src: "/badges/badgeNoSmoking.png", description: "Thanks for joining. Small steps, daily wins—we’re with you." },

    // Leaderboard (Points)
    leader_points_1: { title: "Leaderboard #1 (Points)", src: "/badges/badgeLeaderboard.png", description: "Ranked #1 on the community leaderboard (Points filter)." },
    leader_points_2: { title: "Leaderboard #2 (Points)", src: "/badges/badgeLeaderboard2.png", description: "Top-2 on the community leaderboard (Points filter)." },
    leader_points_3: { title: "Leaderboard #3 (Points)", src: "/badges/badgeLeaderboard3.png", description: "Top-3 on the community leaderboard (Points filter)." },

    // Leaderboard (Streak)
    leader_streak_1: { title: "Leaderboard #1 (Streak)", src: "/badges/badgeLeaderboard.png", description: "Ranked #1 on the community leaderboard (Streak filter)." },
    leader_streak_2: { title: "Leaderboard #2 (Streak)", src: "/badges/badgeLeaderboard2.png", description: "Top-2 on the community leaderboard (Streak filter)." },
    leader_streak_3: { title: "Leaderboard #3 (Streak)", src: "/badges/badgeLeaderboard3.png", description: "Top-3 on the community leaderboard (Streak filter)." },

    // Leaderboard (Saved)
    leader_saved_1: { title: "Leaderboard #1 (Saved)", src: "/badges/badgeLeaderboard.png", description: "Ranked #1 on the community leaderboard (Money Saved filter)." },
    leader_saved_2: { title: "Leaderboard #2 (Saved)", src: "/badges/badgeLeaderboard2.png", description: "Top-2 on the community leaderboard (Money Saved filter)." },
    leader_saved_3: { title: "Leaderboard #3 (Saved)", src: "/badges/badgeLeaderboard3.png", description: "Top-3 on the community leaderboard (Money Saved filter)." },

    // Challenges — totals (your artwork)
    challenge30: { title: "Complete 30 Challenges", src: "/badges/badgeChallenge.png", description: "Thirty challenges completed. You show up—even on tough days." },
    challenge60: { title: "Complete 60 Challenges", src: "/badges/badgeChallenge2.png", description: "Sixty challenges done. Structure and effort are paying off." },
    challenge90: { title: "Complete 90 Challenges", src: "/badges/badgeChallenge3.png", description: "Ninety challenges—discipline, consistency, and growth." },

    // Health milestones
    health: { title: "Health Milestone: 2–12 Weeks", src: "/badges/badgeHealth.png", description: "Circulation improves; early gains in lung function." },
    health2: { title: "Health Milestone: 1 Month", src: "/badges/badgeHealth2.png", description: "Cilia recover and airways clear mucus better." },
    health3: { title: "Health Milestone: 6 Months", src: "/badges/badgeHealth3.png", description: "Cough and phlegm often decrease as lungs heal." },
};


// ---- Helpers ----------------------------------------------------------------
const badgeDoc = (uid, badgeId) => doc(db, "users", uid, "badges", badgeId);

// ---- Health stage order (so we can compare "at or beyond") ------------------
const HEALTH_STAGE_RANK = {
    wk2_to_wk12: 4,
    mo1: 5,
    mo6: 7,
};


// Returns 1/2/3 if the user is in top 3 for the given field in the leaderboard,
// otherwise null. Matches doc.id to uid; falls back to a 'uid' field if present.
async function getLeaderboardRankTop3(field, uid) {
    const col = collection(db, "leaderboard");
    const qTop = query(col, orderBy(field, "desc"), limit(3));
    const snap = await getDocs(qTop);
    let rank = null;
    let pos = 0;
    snap.forEach((docSnap) => {
        pos += 1;
        const row = docSnap.data() || {};
        const docUid = row.uid || docSnap.id; // support either id=uid or explicit field
        if (docUid === uid && rank == null) rank = pos;
    });
    return rank; // 1,2,3 or null
}

export async function getUnlockedBadges(uid, limitN = null) {
    const col = collection(db, "users", uid, "badges");
    const q = limitN ? query(col, orderBy("unlockedAt", "desc"), limit(limitN))
        : query(col, orderBy("unlockedAt", "desc"));
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    return rows;
}

export async function isUnlocked(uid, badgeId) {
    const s = await getDoc(badgeDoc(uid, badgeId));
    return s.exists();
}

// Mark a badge as "seen" so the red dot goes away (persists across refresh/devices)
export async function markBadgeSeen(uid, badgeId) {
    await setDoc(
        badgeDoc(uid, badgeId),
        { seen: true, seenAt: serverTimestamp() },
        { merge: true }
    );
}

export async function unlock(uid, badgeId) {
    if (!uid || !badgeId) return { id: badgeId, skipped: "missing" };
    if (inFlightUnlocks.has(badgeId)) return { id: badgeId, skipped: "inflight" };
    inFlightUnlocks.add(badgeId);

    try {
        // Only one writer wins; others bail early (idempotent write)
        const wrote = await runTransaction(db, async (tx) => {
            const ref = badgeDoc(uid, badgeId);
            const snap = await tx.get(ref);
            if (snap.exists()) return false;
            tx.set(ref, { unlockedAt: serverTimestamp(), seen: false }, { merge: true });
            return true;
        });
        if (!wrote) return { id: badgeId, deduped: true };

        // Try SERVER route first (creates Firestore doc + pushes to all devices)
        try {
            const meta = BADGE_META[badgeId] || {};
            await notifyBadgeUnlocked({
                badgeId,
                badgeName: meta.title || "",
            });
            return { id: badgeId };
        } catch (e) {
            console.warn("notifyBadgeUnlocked failed, falling back to local notification:", e);
        }

        // Fallback: create the card locally; on native it will also push.
        try {
            const meta = BADGE_META[badgeId] || {};
            await createAndPushNotification({
                title: "New badge unlocked!",
                body: meta.title ? `You unlocked: ${meta.title}` : "You unlocked a badge 🎉",
                type: "badge_unlocked",
                data: { badgeId },
                sendPush: true,
            });
        } catch (err) {
            console.warn("Local badge unlock notification failed:", err);
        }

        return { id: badgeId };
    } catch (e) {
        // If Firestore ever bubbles a terminal 'already-exists', treat as success
        if (e?.code === "already-exists") return { id: badgeId, deduped: true };
        throw e;
    } finally {
        inFlightUnlocks.delete(badgeId);
    }
}



// ---- Metrics we rely on ------------------------------------------------------
// We’ll compute everything here so the evaluator is self-contained.

async function countDailyLogs(uid) {
    // This is fine at < few hundred docs. If you outgrow it, move to Firestore count() aggregation.
    const col = collection(db, "users", uid, "dailyLogs");
    const snap = await getDocs(col);
    return snap.size;
}

function computeSavingsEuros(profile, streakDays) {
    const cpd = Number(profile?.cigarettes_per_day_before || 0);
    const pricePerPack = Number(profile?.cost_per_pack || 0);
    const cigsPerPack = Number(profile?.cigarettes_per_pack || 20);
    if (!cigsPerPack || !pricePerPack || !cpd) return 0;
    const packsPerDay = cpd / cigsPerPack;
    return Math.round(packsPerDay * pricePerPack * streakDays);
}

// --- Challenge metrics -------------------------------------------------------
// Counts how many challenges the user has completed.
// Assumes each challenge doc has: { user_id, completed (bool), ... }
async function countCompletedChallenges(uid, cap = 2000) {
    const colRef = collection(db, "Challenge");
    // Equality filter only (no composite index required). Cap to keep it light.
    const qUser = query(colRef, where("user_id", "==", uid), limit(cap));
    const snap = await getDocs(qUser);

    let done = 0;
    snap.forEach((d) => {
        const row = d.data() || {};
        if (row.completed) done += 1;
    });
    return done;
}


// ---- Main evaluator ----------------------------------------------------------
// Call this after meaningful actions and on app start.
export async function evaluateAndUnlockBadges(uid) {
    // Bail if no user or if auth state doesn't match the uid we’re evaluating for.
    const curUid = getAuth().currentUser?.uid || null;
    if (!uid || uid !== curUid) return [];   // <-- prevents work while signed out / mismatch

    // Wrap all Firestore reads once. If we get permission-denied, just stop quietly.
    try {
        const profile = await getUserProfile(uid);
        const todayIso = new Date().toISOString().slice(0, 10);
        const quitIso = (profile?.quit_date || "").slice(0, 10) || null;

        const streak = await computeStreakFromQuit(uid, quitIso, todayIso);
        const streakDays = Number(streak.current_streak_days || 0);

        const logsCount = await countDailyLogs(uid);
        const aiCount = Number(profile?.ai_messages_count || 0);
        const hypCount = Number(profile?.audio_sessions_count || 0);
        const savings = computeSavingsEuros(profile, streakDays);

        const healthStageId = String(profile?.health_stage_id || "");
        const healthRank = HEALTH_STAGE_RANK[healthStageId] ?? -1;


        // If you added challenge totals:
        let completedChallenges = 0;
        try {
            // Do this once, not inside conditions
            const colRef = collection(db, "Challenge");
            const qRef = query(colRef,
                where("user_id", "==", uid),
                where("completed", "==", true)
            );
            const snap = await getDocs(qRef);
            completedChallenges = snap.size;
        } catch (e) {
            if (e?.code === "permission-denied") return []; // signed out; stop now
            // otherwise keep going; treat as zero
            completedChallenges = 0;
        }

        // Leaderboard ranks (reads are public by your rules)
        const pointsRank = await getLeaderboardRankTop3("points", uid);
        const streakRank = await getLeaderboardRankTop3("streak", uid);
        const savedRank = await getLeaderboardRankTop3("saved", uid);

        // Define conditions here (single source of truth)
        const conditions = [
            // Welcome
            ["welcome", () => !!profile?.createdAt],

            // Streak thresholds
            ["streak1", () => streakDays >= 1],
            ["streak2", () => streakDays >= 2],
            ["streak3", () => streakDays >= 3],
            ["streak5", () => streakDays >= 5],
            ["streak10", () => streakDays >= 10],
            ["streak20", () => streakDays >= 20],
            ["streak30", () => streakDays >= 30],
            ["streak50", () => streakDays >= 50],
            ["streak75", () => streakDays >= 75],
            ["streak100", () => streakDays >= 100],
            ["streak200", () => streakDays >= 200],
            ["streak365", () => streakDays >= 365],
            ["streak500", () => streakDays >= 500],
            ["streak600", () => streakDays >= 600],
            ["streak700", () => streakDays >= 700],
            ["streak800", () => streakDays >= 800],
            ["streak900", () => streakDays >= 900],
            ["streak1000", () => streakDays >= 1000],

            // Daily log milestones
            ["log", () => logsCount >= 10],
            ["log2", () => logsCount >= 30],
            ["log3", () => logsCount >= 100],

            // AI coach messages sent by user (we’ll increment this when sending)
            ["ai1", () => aiCount >= 10],
            ["ai2", () => aiCount >= 30],
            ["ai3", () => aiCount >= 100],

            // Hypnosis listens (we increment this when the user hits Play)
            ["hypnosis1", () => hypCount >= 2],
            ["hypnosis2", () => hypCount >= 6],
            ["hypnosis3", () => hypCount >= 10],

            // Savings milestones
            ["saving", () => savings >= 100],
            ["saving2", () => savings >= 500],
            ["saving3", () => savings >= 1000],

            // Leaderboard — Points
            ["leader_points_1", () => pointsRank === 1],
            ["leader_points_2", () => pointsRank === 2],
            ["leader_points_3", () => pointsRank === 3],

            // Leaderboard — Streak
            ["leader_streak_1", () => streakRank === 1],
            ["leader_streak_2", () => streakRank === 2],
            ["leader_streak_3", () => streakRank === 3],

            // Leaderboard — Money Saved
            ["leader_saved_1", () => savedRank === 1],
            ["leader_saved_2", () => savedRank === 2],
            ["leader_saved_3", () => savedRank === 3],

            // Challenges — totals
            ["challenge30", () => completedChallenges >= 30],
            ["challenge60", () => completedChallenges >= 60],
            ["challenge90", () => completedChallenges >= 90],

            // Health milestone badges
            ["health", () => healthRank >= HEALTH_STAGE_RANK["wk2_to_wk12"]],
            ["health2", () => healthRank >= HEALTH_STAGE_RANK["mo1"]],
            ["health3", () => healthRank >= HEALTH_STAGE_RANK["mo6"]],

        ];

        const newlyUnlocked = [];
        for (let i = 0; i < conditions.length; i++) {
            const entry = conditions[i];
            if (!Array.isArray(entry) || entry.length < 2) continue;

            const [id, check] = entry;
            try {
                if (!(await isUnlocked(uid, id)) && check()) {
                    await unlock(uid, id);
                    newlyUnlocked.push(id);
                }
            } catch (e) {
                // If user just signed out between reads/writes, don’t spam the console
                if (e?.code === "permission-denied" || String(e?.message || "").includes("insufficient permissions")) {
                    return newlyUnlocked; // quiet exit
                }
                console.warn(`Condition "${id}" evaluation failed:`, e);
            }
        }
        return newlyUnlocked;
    } catch (e) {
        // Any top-level read that fails due to sign-out
        if (e?.code === "permission-denied" || String(e?.message || "").includes("insufficient permissions")) {
            return [];
        }
        // Keep original behavior for other errors
        console.warn("evaluateAndUnlockBadges failed:", e);
        return [];
    }
}

