// src/services/notifications.js
/**
 * Module: In-app notifications & push handoff
 *
 * Purpose
 * - Observe and manage per-user notification documents.
 * - Create a stored notification card and optionally request a server push
 *   (only on native via Capacitor).
 * - Register device tokens with the server.
 *
 * Key exports
 * - observeMyNotifications(cb), observeUnreadCount(cb)
 * - markNotificationRead(id), markAllAsRead()
 * - createAndPushNotification({ title, body, type, data, sendPush })
 * - notifyBadgeUnlocked({ badgeId, badgeName })
 * - registerPushTokenOnServer(token, platform?)
 *
 * Environment
 * - API_BASE derives from VITE_API_BASE or sensible default (native emulator vs web).
 * - Push calls require a Firebase ID token (getFirebaseIdToken).
 *
 * Data model
 * - users/{uid}/notifications/{id}: { title, body, type, data, read, createdAt }
 *
 * Notes
 * - On web, push dispatch is skipped; in-app cards still created.
 * - Server endpoints are expected to validate Authorization and route push.
 */

import { auth, db, getFirebaseIdToken } from "@/firebase";
import {
    addDoc, collection, doc, getDocs, onSnapshot, orderBy, query,
    serverTimestamp, updateDoc, where,
} from "firebase/firestore";
import { Capacitor } from "@capacitor/core";

const API_BASE = (import.meta.env?.VITE_API_BASE)
    ? import.meta.env.VITE_API_BASE
    : (Capacitor.isNativePlatform() ? "http://10.0.2.2:8787/api" : "/api");
export { API_BASE };

function notifsCol(uid) { return collection(db, "users", uid, "notifications"); }

export function observeMyNotifications(cb, lim = 100) {
    const uid = auth.currentUser?.uid;
    if (!uid) return () => { };
    const q = query(notifsCol(uid), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
        cb(snap.docs.map((d) => {
            const x = d.data();
            return { id: d.id, ...x, createdAt: x?.createdAt?.toDate ? x.createdAt.toDate() : new Date() };
        }));
    });
}

export function observeUnreadCount(cb) {
    const uid = auth.currentUser?.uid;
    if (!uid) return () => { };
    const q = query(collection(db, "users", uid, "notifications"), where("read", "==", false));
    return onSnapshot(q, (snap) => cb(snap.size || 0));
}

export async function markNotificationRead(id) {
    const uid = auth.currentUser?.uid;
    if (!uid || !id) return;
    await updateDoc(doc(db, "users", uid, "notifications", id), { read: true });
}

export async function markAllAsRead() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = query(notifsCol(uid), where("read", "==", false));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) =>
        updateDoc(doc(db, "users", uid, "notifications", d.id), { read: true })
    ));
}

// General utility to create a stored notification (and optionally push)
export async function createAndPushNotification({ title, body, type = "generic", data = {}, sendPush = true }) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("No authenticated user");
    const ref = await addDoc(notifsCol(uid), {
        title: String(title || "Notification"),
        body: String(body || ""),
        type: String(type || "generic"),
        data: data || {},
        read: false,
        createdAt: serverTimestamp(),
    });
    if (sendPush && Capacitor.isNativePlatform()) {
        const idToken = await getFirebaseIdToken(true);
        if (idToken) {
            await fetch(`${API_BASE}/push/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ title, body, data: { type, ...data, notificationId: ref.id } }),
            }).catch(() => { });
        }
    }
    return ref.id;
}

// Convenience: call when you award a badge (server writes + server pushes)
export async function notifyBadgeUnlocked({ badgeId, badgeName }) {
    const idToken = await getFirebaseIdToken(true);
    if (!idToken) throw new Error("No ID token");

    const resp = await fetch(`${API_BASE}/push/badge-unlocked`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
            badgeId: String(badgeId || ""),
            badgeName: String(badgeName || ""),
        }),
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`badge-unlocked ${resp.status}: ${text}`);
    }
    return resp.json().catch(() => ({}));
}


// Register device token with server
export async function registerPushTokenOnServer(token, platform = "android") {
    const idToken = await getFirebaseIdToken(true);
    if (!idToken) return;
    const resp = await fetch(`${API_BASE}/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ token, platform }),
    });
    if (!resp.ok) throw new Error(`register ${resp.status}`);
    return resp.json().catch(() => ({}));
}
