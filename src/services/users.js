// src/services/users.js
/**
 * Module: User profile, usernames, uploads, points & leaderboard
 *
 * Purpose
 * - Manage user documents, claim unique usernames (transactionally),
 *   observe profile changes, and persist updates.
 * - Handle profile photo uploads to Storage and URL propagation.
 * - Award points atomically on challenge completion.
 * - Publish a denormalized leaderboard row for quick ranking queries.
 *
 * Key exports
 * - normalizeUsername(name)
 * - claimUsernameAndCreateProfile(uid, { email, username })
 * - getUserProfile(uid), observeUserProfile(uid, cb), updateUserProfile(uid, data)
 * - ensureUserDocument(uid, defaults?)
 * - completeChallengeAndAwardPoints(challengeId, points) → new total_points
 * - publishLeaderboardRow(uid)
 *
 * Data model
 * - users/{uid}: profile fields + totals, createdAt/updatedAt timestamps.
 * - usernames/{username}: { uid, createdAt } for uniqueness claims.
 * - Challenge/{id}: per-user challenges (completed/awarded flags).
 * - leaderboard/{uid}: { name, avatar, points, streak, saved, lifeYears, updatedAt }.
 *
 * Notes
 * - Username claim uses a transaction and candidate fallbacks.
 * - Challenge completion is idempotent (checks completed/awarded).
 * - Leaderboard publishing is best-effort and can be called after profile changes.
 */

import { db } from "@/firebase";
import { doc, runTransaction, serverTimestamp, increment } from "firebase/firestore";
import { storage, auth } from "@/firebase";
import { getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export const normalizeUsername = (name = "") =>
  name
    .trim()
    .toLowerCase()
    .replace(/^@/, "")                                // drop leading @
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")// strip accents
    .replace(/[^a-z0-9_]/g, "")                       // allow a-z 0-9 _
    .replace(/_{2,}/g, "_")                           // collapse __
    .replace(/^_+|_+$/g, "")                          // trim _
    .slice(0, 24);                                    // keep up to 24 chars

export async function claimUsernameAndCreateProfile(uid, { email, username }) {
  if (!uid) throw new Error("Missing uid");
  let base = normalizeUsername(username);
  if (!base) throw new Error("USERNAME_REQUIRED");

  const userRef = doc(db, "users", uid);

  // try base, then base_XXXX up to 6 tries
  const candidates = [base];
  for (let i = 0; i < 6; i++) {
    candidates.push(`${base}_${Math.random().toString(36).slice(2, 6)}`);
  }

  let claimed = null;
  await runTransaction(db, async (tx) => {
    // read user doc once to decide whether to set createdAt
    const userSnap = await tx.get(userRef);
    for (const uname of candidates) {
      const unameRef = doc(db, "usernames", uname);
      const unameSnap = await tx.get(unameRef);
      if (unameSnap.exists()) continue; // try next candidate

      // claim username
      tx.set(unameRef, { uid, createdAt: serverTimestamp() });

      // merge to avoid clobbering existing fields
      tx.set(
        userRef,
        {
          email: email ?? null,
          username: uname,
          displayName: username ?? uname,
          photoURL: userSnap.exists() ? (userSnap.data()?.photoURL ?? null) : null,
          theme: userSnap.exists() ? (userSnap.data()?.theme ?? "forest") : "forest",
          updatedAt: serverTimestamp(),
          total_points: userSnap.exists() ? (userSnap.data()?.total_points ?? 0) : 0,
          ...(userSnap.exists() ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );

      // seed leaderboard (merge)
      tx.set(
        doc(db, "leaderboard", uid),
        {
          userId: uid,
          name: username ?? uname,
          avatar: userSnap.exists() ? (userSnap.data()?.photoURL ?? null) : null,
          points: userSnap.exists() ? (userSnap.data()?.total_points ?? 0) : 0,
          streak: 0,
          saved: 0,
          lifeYears: 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      claimed = uname;
      break;
    }
    if (!claimed) throw new Error("USERNAME_TAKEN");
  });
  return claimed;
}


export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

let _lbTimer = null;

export function observeUserProfile(uid, cb) {
  const userRef = doc(db, "users", uid);
  return onSnapshot(
    userRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      cb(data);
      if (data) {
        clearTimeout(_lbTimer);
        _lbTimer = setTimeout(() => publishLeaderboardRow(uid).catch(() => { }), 500);
      }
    }, (err) => {
      if (err?.code === "permission-denied" || err?.code === "unauthenticated") {
        // Happens during sign-out: ignore silently.
        return;
      }
      console.error("observeUserProfile error:", err);
    }
  );
}


export async function updateUserProfile(uid, data) {
  await setDoc(
    doc(db, "users", uid),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function ensureUserDocument(uid, defaults = {}) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: auth.currentUser?.email || "",
      displayName: auth.currentUser?.displayName || "",
      photoURL: null,
      theme: "forest",
      totals: { totalPoints: 0 },
      total_points: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...defaults,
    });
  }
}

export async function uploadProfilePhoto(uid, file) {
  const sref = ref(storage, `users/${uid}/profile/profile.jpg`);
  const meta = { contentType: file.type || "image/jpeg" };
  await uploadBytes(sref, file, meta);
  const url = await getDownloadURL(sref);
  // store URL on the user doc
  await setDoc(
    doc(db, "users", uid),
    { photoURL: url, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return url;
}

/**
 * Atomically:
 *  - verifies the challenge belongs to current user and isn't completed
 *  - sets `completed: true` (+ completedAt)
 *  - increments /users/{uid}.total_points by `points`
 * Returns the new total_points.
 */
export async function completeChallengeAndAwardPoints(challengeId, points) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");

  const cRef = doc(db, "Challenge", challengeId);
  const uRef = doc(db, "users", uid);
  const lbRef = doc(db, "leaderboard", uid);

  await runTransaction(db, async (tx) => {
    const cSnap = await tx.get(cRef);
    if (!cSnap.exists()) throw new Error("Challenge not found");
    const c = cSnap.data();

    if (c.user_id !== uid) throw new Error("Forbidden");

    // Idempotency guard
    if (c.completed === true || c.awarded === true) return;

    // Use server-authoritative points if present; fall back to param
    const pts = Number(c.points ?? points) || 0;

    // Mark completed + awarded once
    tx.update(cRef, { completed: true, awarded: true, completedAt: serverTimestamp() });

    // Safely bump totals (works even if user doc doesn’t exist yet)
    tx.set(uRef, { total_points: increment(pts) }, { merge: true });

    // Keep leaderboard points in sync
    tx.set(
      lbRef,
      { userId: uid, points: increment(pts), updatedAt: serverTimestamp() },
      { merge: true }
    );
  });

  // Return fresh total
  const uSnap = await getDoc(doc(db, "users", uid));
  return uSnap.data()?.total_points ?? 0;
}



// helpers
const safeNum = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;

function computeSavedAndLifeYears(profile) {
  const streakDays = safeNum(profile.current_streak_days, 0);
  const cpd = safeNum(profile.cigarettes_per_day_before, 0);
  const cpp = safeNum(profile.cost_per_pack, 0);
  const cppk = safeNum(profile.cigarettes_per_pack, 20);
  const packsPerDay = cppk ? cpd / cppk : 0;

  const saved = Math.round(packsPerDay * cpp * streakDays); // €
  const lifeMinutes = cpd * 11 * streakDays;
  const lifeYears = lifeMinutes / (60 * 24 * 365);

  return { saved, lifeYears };
}

// at top you already have: getDoc, setDoc, doc, serverTimestamp imported

export async function publishLeaderboardRow(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return;

  const u = snap.data() || {};
  const name =
    u.displayName || u.username || (u.email ? String(u.email).split("@")[0] : "User");
  const avatar = u.photoURL || null;
  const points =
    Number(u.total_points ?? u.totalPoints ?? u?.totals?.totalPoints ?? 0) || 0;

  // streak (prefer stored, fallback from quit_date)
  const today = new Date();
  let streak = typeof u.current_streak_days === "number" ? u.current_streak_days : 0;
  if (!streak && u.quit_date) {
    const qd = new Date(u.quit_date);
    if (!isNaN(qd) && qd <= today) {
      const d1 = new Date(qd.getFullYear(), qd.getMonth(), qd.getDate());
      const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      streak = Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    }
  }

  // saved € and life years
  const cpd = Number(u.cigarettes_per_day_before) || 0;
  const cpp = Number(u.cost_per_pack) || 0;
  const cppk = Number(u.cigarettes_per_pack) || 20;
  const packsPerDay = cppk ? cpd / cppk : 0;
  const saved = Math.round(packsPerDay * cpp * streak);
  const lifeYears = (cpd * 11 * streak) / (60 * 24 * 365);

  await setDoc(
    doc(db, "leaderboard", uid),
    {
      userId: uid,
      name,
      avatar,
      points,
      streak,
      saved,
      lifeYears,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
