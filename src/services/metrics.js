// src/services/metrics.js
/**
 * Module: Simple usage counters
 *
 * Purpose
 * - Increment lightweight per-user counters used for badges/analytics
 *   without requiring reads first (serverTimestamp + increment).
 *
 * Key exports
 * - incAiMessages(uid, delta?)
 * - incAudioSessions(uid, delta?)
 *
 * Notes
 * - Safe to call frequently; writes merge into users/{uid}.
 * - Firestore security must allow the merge writes.
 */

import { db } from "@/firebase";
import { doc, setDoc, increment, serverTimestamp } from "firebase/firestore";

const userDoc = (uid) => doc(db, "users", uid);

export async function incAiMessages(uid, delta = 1) {
  if (!uid) return;
  await setDoc(userDoc(uid), {
    ai_messages_count: increment(delta),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function incAudioSessions(uid, delta = 1) {
  if (!uid) return;
  await setDoc(userDoc(uid), {
    audio_sessions_count: increment(delta),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
