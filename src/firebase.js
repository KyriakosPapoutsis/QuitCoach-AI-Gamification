// src/firebase.js
/**
 * Module: Firebase initialization
 *
 * Purpose
 * - Initializes Firebase App, Auth, Firestore, and Storage.
 * - Sets up IndexedDB persistence for auth (fallback to browser localStorage).
 * - Exports helpers for retrieving the current user’s ID token.
 *
 * Security
 * - Contains only public project config (safe for client use).
 * - Secrets remain protected server-side.
 *
 * Optional
 * - Lazy-loads Analytics if supported and available.
 */

import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Read from Vite env
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // Optional:
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Helpful dev-time warning (no hard failure to keep storybooks/builds flexible)
if (import.meta.env.DEV) {
  const missing = Object.entries(cfg)
    .filter(([k, v]) => k !== "measurementId" && !v)
    .map(([k]) => k);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(
      "[firebase] Missing env vars:",
      missing.join(", "),
      "— set them in .env.local (see .env.example)."
    );
  }
}

const app = initializeApp(cfg);

export const auth = getAuth(app);
(async () => {
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch {
    await setPersistence(auth, browserLocalPersistence);
  }
})();

export const db = getFirestore(app);
export const storage = getStorage(app);

// Helper for server calls
export async function getFirebaseIdToken(force = false) {
  const u = auth.currentUser;
  if (!u) return null;
  return u.getIdToken(force);
}

// (Optional) Analytics lazy-load guarded
let analytics = null;
if (typeof window !== "undefined") {
  import("firebase/analytics").then(async ({ getAnalytics, isSupported }) => {
    try {
      if (await isSupported()) analytics = getAnalytics(app);
    } catch { /* ignore */ }
  });
}
export { analytics };
