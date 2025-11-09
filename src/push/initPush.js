/**
 * initPush.js
 * -------------
 * Purpose: Initializes push notification handling for both Android (via Capacitor)
 *           and web fallback (when available). Handles permission checks, token
 *           registration, and routing logic for notification interactions.
 *
 * Responsibilities:
 * - Requests and verifies push notification permissions.
 * - Registers device tokens with Firebase Auth and the backend server.
 * - Creates an Android notification channel (if applicable).
 * - Displays foreground notifications as mirrored local banners.
 * - Responds to notification taps with navigation (Daily Log, Challenges, etc.).
 *
 * Data Flow:
 * - Token registration via registerPushTokenOnServer(token, platform)
 * - Auth state listener ensures tokens are re-registered after login.
 * - Uses Capacitor App and PushNotifications plugins for lifecycle and events.
 *
 * Dev Notes:
 * - Only runs on native platforms (Capacitor apps); safe no-op on web.
 * - Foreground banners simulated using LocalNotifications for consistency.
 * - CHANNEL_ID must match server configuration for Android notification routing.
 */

import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { onAuthStateChanged } from "firebase/auth";
import { App } from "@capacitor/app";
import { auth } from "@/firebase";
import { registerPushTokenOnServer } from "@/services/notifications";

const CHANNEL_ID = "default"; 

let lastToken = null;
let initialized = false;
let appIsActive = true;

async function ensureAndroidChannel() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "General",
      description: "Default notification channel",
      importance: 4, // HIGH
      visibility: 1, // PUBLIC
      lights: true,
      vibration: true,
      sound: "default",
    });
  } catch {}
}

function trackAppState() {
  try {
    App.getState().then(({ isActive }) => (appIsActive = !!isActive));
    App.addListener("appStateChange", ({ isActive }) => {
      appIsActive = !!isActive;
    });
  } catch {}
}

function go(path) {
  try {
    // No router import required; this works in Capacitor WebView + BrowserRouter.
    window.location.href = path || "/notifications";
  } catch {}
}

async function mirrorForegroundBanner(n) {
  if (!appIsActive) return; // system banner will show in background
  const title = n?.title || n?.data?.title || "Notification";
  const body = n?.body || n?.data?.body || "";
  const data = n?.data || {};
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2147483647),
          title,
          body,
          channelId: CHANNEL_ID,
          extra: data,
        },
      ],
    });
  } catch {}
}

export async function initPush() {
  if (initialized) return;
  initialized = true;
  if (!Capacitor.isNativePlatform()) return;

  trackAppState();
  await ensureAndroidChannel();

  // Permissions
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== "granted") {
    perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
  }

  // Foreground: mirror as local notification for heads-up
  PushNotifications.addListener("pushNotificationReceived", mirrorForegroundBanner);

  // Tap handling (cold/warm)
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action?.notification?.data || {};
    const type = String(data.type || "");
    switch (type) {
      case "daily_log":
        go("/daily-log");
        break;
      case "daily_challenges":
        go("/challenges");
        break;
      case "badge_unlocked":
        go("/notifications"); // change to /badges if you have it
        break;
      default:
        go("/notifications");
    }
  });

  // Registration
  PushNotifications.addListener("registration", async (token) => {
    lastToken = token?.value || null;
    if (auth.currentUser && lastToken) {
      try {
        await registerPushTokenOnServer(lastToken, "android");
      } catch (e) {
        console.error("registerPushTokenOnServer failed:", e?.message || e);
      }
    }
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.error("Push registration error:", err);
  });

  // After login, if token ready, register it
  onAuthStateChanged(auth, async (u) => {
    if (u && lastToken) {
      try {
        await registerPushTokenOnServer(lastToken, "android");
      } catch (e) {
        console.error("register after login failed:", e?.message || e);
      }
    }
  });

  try {
    await PushNotifications.register();
  } catch (e) {
    console.error("Push register call failed:", e);
  }
}
