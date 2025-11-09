/**
 * server/push.js
 * Push notification router and scheduled jobs for Quit Coach.
 * - /api/push/register: registers device tokens.
 * - /api/push/send: sends notifications to the current user.
 * - /api/push/badge-unlocked: pushes badge achievement alerts.
 * - scheduleDailyPushJobs(): sends daily log and challenge reminders (20:30 & 20:35 Athens time).
 * Used by server/index.js.
 */

import express from "express";
import cron from "node-cron";

// read user's notification prefs once
async function getUserPrefs(fdb, uid) {
  try {
    const snap = await fdb.collection("users").doc(uid).get();
    return snap.exists ? (snap.data().notification_preferences || {}) : {};
  } catch {
    return {};
  }
}

/**
 * Build a router mounted under /api/push (api is already auth-protected in index.js).
 * Expects req.uid (set by your requireFirebaseAuth middleware).
 */
export function buildPushRouter(admin, fdb) {
  const router = express.Router();

  // Helper: multicast push + cleanup bad tokens
  async function multicastPush(uid, { title, body, data = {} }) {
    const snap = await fdb.collection("users").doc(uid).collection("devices").get();
    const tokens = snap.docs.map(d => d.id).filter(Boolean);
    if (!tokens.length) return { sent: 0, failed: 0 };

    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: String(title || "Notification"), body: String(body || "") },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: "high", notification: { channelId: "default" } },
    });

    // remove invalid tokens
    const bad = resp.responses
      .map((r, i) => (r.success ? null : tokens[i]))
      .filter(Boolean);
    await Promise.all(
      bad.map(t => fdb.collection("users").doc(uid).collection("devices").doc(t).delete())
    );

    return { sent: resp.successCount, failed: resp.failureCount };
  }

  // Save/update a device token
  router.post("/register", async (req, res) => {
    try {
      const { token, platform = "android" } = req.body || {};
      if (!req.uid) return res.status(401).json({ error: "unauthorized" });
      if (!token) return res.status(400).json({ error: "token required" });

      await fdb
        .collection("users")
        .doc(req.uid)
        .collection("devices")
        .doc(token)
        .set(
          {
            token,
            platform,
            lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      res.json({ ok: true });
    } catch (e) {
      console.error("POST /push/register", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Send a push to the current user (no storage)
  router.post("/send", async (req, res) => {
    try {
      const uid = req.uid;
      if (!uid) return res.status(401).json({ error: "unauthorized" });
      const { title, body, data = {} } = req.body || {};
      const r = await multicastPush(uid, { title, body, data });
      res.json({ ok: true, ...r });
    } catch (e) {
      console.error("POST /push/send", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Triggered when a new badge is unlocked (create doc + push)
  router.post("/badge-unlocked", async (req, res) => {
    try {
      const uid = req.uid;
      if (!uid) return res.status(401).json({ error: "unauthorized" });
      const { badgeId, badgeName } = req.body || {};
      const title = "New badge unlocked!";
      const body = badgeName ? `You unlocked "${badgeName}" 🎉` : "Great job—new badge!";
      const type = "badge_unlocked";
      const notifRef = await fdb
        .collection("users").doc(uid)
        .collection("notifications")
        .add({
          title, body, type,
          data: { badgeId: String(badgeId || ""), badgeName: String(badgeName || "") },
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Respect user pref: milestone_alerts (store doc regardless)
      const prefs = await getUserPrefs(fdb, uid);
      const allowPush = prefs.milestone_alerts !== false; const snap = await fdb.collection("users").doc(uid).collection("devices").get();
      const tokens = snap.docs.map(d => d.id).filter(Boolean);
      if (tokens.length && allowPush) {
        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: { type, notificationId: notifRef.id, badgeId: String(badgeId || ""), badgeName: String(badgeName || "") },
          android: { priority: "high", notification: { channelId: "default" } },
        });
      }

      res.json({ ok: true, id: notifRef.id, pushed: tokens.length });

    } catch (e) {
      console.error("POST /push/badge-unlocked", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Health (internal)
  router.get("/_health", (_req, res) => res.json({ ok: true, router: "push" }));

  return router;
}

// Two daily cron jobs that send push reminders (Athens timezone)
export function scheduleDailyPushJobs(admin, fdb) {
  const tz = "Europe/Athens";

  const todayISOAthens = (date = new Date()) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date).replace(/\//g, "-");

  const sendToUser = async (uid, { title, body, type, data, prefKey }) => {
    // Skip entirely if user turned this category off
    const notifId = `${type}_${todayISOAthens()}`;
    const notifDoc = fdb.collection("users").doc(uid).collection("notifications").doc(notifId);
    const exists = await notifDoc.get();
    if (exists.exists) return; // already sent today

    await notifDoc.set({
      title, body, type,
      data: data || {},
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: false });

    const prefs = prefKey ? await getUserPrefs(fdb, uid) : {};
    const allowPush = prefKey ? prefs[prefKey] !== false : true;

    const tokensSnap = await fdb.collection("users").doc(uid).collection("devices").get();
    const tokens = tokensSnap.docs.map(d => d.id).filter(Boolean);
    if (tokens.length && allowPush) {
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: {
          type,
          notificationId: notifId,
          ...(Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)]))),
        },
        android: { priority: "high", notification: { channelId: "default" } },
      });
    };

    // 20:30 — Daily log
    cron.schedule(
      "30 20 * * *",
      async () => {
        try {
          const usersSnap = await fdb.collection("users").get();
          const iso = todayISOAthens();
          await Promise.all(usersSnap.docs.map(async (u) => {
            const uid = u.id;
            // Only if user hasn't logged today
            const log = await fdb.collection("users").doc(uid).collection("dailyLogs").doc(iso).get();
            if (log.exists) return;
            await sendToUser(uid, {
              title: "Add your daily log!",
              body: "Quick check-in takes 30 seconds.",
              type: "daily_log",
              data: { date: iso },
              prefKey: "daily_reminders",
            });
          }));
        } catch (e) { console.error("cron daily_log:", e); }
      },
      { timezone: tz }
    );

    // 20:35 — Daily challenges
    cron.schedule(
      "35 20 * * *",
      async () => {
        try {
          const usersSnap = await fdb.collection("users").get();
          const iso = todayISOAthens();
          await Promise.all(usersSnap.docs.map(async (u) => {
            const uid = u.id;
            // If user already has uncompleted challenges due today, skip
            const qs = await fdb
              .collection("Challenge")
              .where("user_id", "==", uid)
              .where("due_date", "==", iso)
              .where("completed", "==", false)
              .limit(1)
              .get();
            if (!qs.empty) return;
            await sendToUser(uid, {
              title: "Generate your 3 daily challenges!",
              body: "Get 3 quick wins to stay on track.",
              type: "daily_challenges",
              data: { date: iso },
              prefKey: "challenge_notifications",
            });
          }));
        } catch (e) { console.error("cron daily_challenges:", e); }
      },
      { timezone: tz }
    );
  }
}
