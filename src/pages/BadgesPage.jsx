/**
 * BadgesPage.jsx
 * ----------------
 * Purpose: Full badge catalog page with live unlocked state from Firestore
 *          and an always-mounted modal for details.
 *
 * Data Model:
 * - Static catalog derived from BADGE_META (id, title, src, description).
 * - Live overlay of user unlocks via users/{uid}/badges ordered by unlockedAt.
 *
 * UX:
 * - Stable grid from first render (catalog first, then overlay unlocks).
 * - Clicking a card opens a modal with large art, description, and timestamp.
 * - Back button navigates to Challenges.
 *
 * Dev Notes:
 * - Subscribes to Firestore on mount; non-blocking call to evaluate badges.
 * - Modal wrapper remains in the DOM (accessibility + ESC key close).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Lock, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "@/firebase";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { BADGE_META, evaluateAndUnlockBadges } from "@/services/badges";

/* ---------- Build a stable, sorted catalog once ---------- */
const CATALOG = Object.entries(BADGE_META)
  .map(([id, meta]) => ({
    id,
    title: meta.title,
    src: meta.src,
    description: meta.description,
    unlocked: false,
    unlockedAt: null,
  }))
  .sort((a, b) => a.title.localeCompare(b.title));

/* ---------- Modal: wrapper always rendered (hidden when closed) ---------- */
function BadgeModal({ badge, onClose }) {
  const open = !!badge;

  // ESC to close (only when open)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const unlockedTxt = (() => {
    try {
      if (badge?.unlockedAt?.toDate) return badge.unlockedAt.toDate().toLocaleString();
    } catch {}
    return null;
  })();

  return (
    <div
      className={open ? "fixed inset-0 z-[100] flex items-center justify-center" : "fixed inset-0 z-[100] hidden"}
      role="dialog"
      aria-modal="true"
    >
      {/* overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {/* content */}
      <div className="relative z-[101] w-[min(92vw,700px)] rounded-2xl border border-white/10 bg-[#0c0f14] p-6 shadow-2xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-2 sm:p-3 text-white/80 hover:text-white focus:outline-none"
        >
          <span aria-hidden className="text-3xl sm:text-4xl leading-none">×</span>
        </button>

        <div className="w-full flex items-center justify-center">
          <div className="relative">
            <img
              src={badge?.src}
              alt={badge?.title || "Badge"}
              className="w-[260px] h-[260px] sm:w-[320px] sm:h-[320px] object-contain drop-shadow-xl"
              style={{
                filter: badge?.unlocked ? "none" : "grayscale(100%)",
                opacity: badge?.unlocked ? 1 : 0.5,
              }}
            />
            <div
              className="absolute inset-0 flex items-center justify-center rounded-xl"
              style={{
                backgroundColor: badge?.unlocked ? "transparent" : "rgba(0,0,0,0.4)",
                pointerEvents: "none",
              }}
            >
              {!badge?.unlocked && <Lock className="w-16 h-16 text-white/90" />}
            </div>
          </div>
        </div>

        <h3 className="mt-4 text-center text-2xl font-bold text-white">{badge?.title}</h3>
        <div className="mx-auto mt-3 h-[6px] w-28 rounded-full" style={{ background: "var(--hero-grad)" }} />

        {badge?.description ? (
          <p className="text-white/80 text-sm sm:text-base mt-4 text-center">{badge.description}</p>
        ) : null}

        {unlockedTxt ? (
          <p className="text-white/50 text-xs mt-4 text-center">Unlocked on {unlockedTxt}</p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Grid & Card ---------- */
function BadgeGrid({ badges, onBadgeClick }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-7">
      {badges.map((b) => (
        <BadgeCard key={b.id} {...b} onClick={() => onBadgeClick?.(b)} />
      ))}
    </div>
  );
}

// Always render a <button> (stable type)
function BadgeCard({ title, src, unlocked, onClick }) {
  const base =
    "soft-card rounded-3xl p-5 border border-white/15 bg-white/5 backdrop-blur-lg " +
    "shadow-[0_0_30px_rgba(255,255,255,0.08)] hover:shadow-[0_0_40px_rgba(255,255,255,0.16)] " +
    "transition-shadow text-left w-full";

  return (
    <button type="button" onClick={onClick} className={base}>
      <div className="relative w-full aspect-square flex items-center justify-center overflow-visible">
        <img
          src={src}
          alt={title}
          className="scale-125 object-contain transition"
          loading="lazy"
          style={{
            filter: unlocked ? "none" : "grayscale(100%)",
            opacity: unlocked ? 1 : 0.5,
          }}
        />
        <div
          className="absolute inset-0 flex items-center justify-center rounded-2xl"
          style={{
            backgroundColor: unlocked ? "transparent" : "rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        >
          {!unlocked && <Lock className="w-8 h-8 text-white/90" />}
        </div>
      </div>

      <div className="mt-4 text-center">
        <div className="text-white text-[1.05rem] font-semibold">{title}</div>
        <div className="mx-auto mt-2 h-[6px] w-20 rounded-full" style={{ background: "var(--hero-grad)" }} />
      </div>
    </button>
  );
}

/* ---------- Page ---------- */
export default function BadgesPage() {
  const navigate = useNavigate();

  // Start with the full catalog so the grid is stable from the first render
  const [badges, setBadges] = useState(CATALOG);
  const [selectedBadge, setSelectedBadge] = useState(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // Non-blocking catch-up
    evaluateAndUnlockBadges(uid).catch(() => {});

    const colRef = collection(db, "users", uid, "badges");
    const qRef = query(colRef, orderBy("unlockedAt", "desc"));
    const unsubscribe = onSnapshot(
      qRef,
      (snap) => {
        const unlockedMap = new Map();
        snap.forEach((d) => unlockedMap.set(d.id, d.data() || {}));

        // Overlay unlocked state onto the fixed catalog
        setBadges(
          CATALOG.map((item) => {
            const row = unlockedMap.get(item.id);
            return {
              ...item,
              unlocked: !!row,
              unlockedAt: row?.unlockedAt ?? null,
            };
          })
        );
      },
      (err) => {
        console.error("BadgesPage subscribe failed:", err);
      }
    );
    return () => unsubscribe();
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back button (stable) */}
      <button
        onClick={() => navigate("/challenges")}
        className="flex items-center gap-2 rounded-full px-4 py-2 bg-white/10 hover:bg-white/15 
                   border border-white/20 text-white text-sm backdrop-blur-md"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Challenges
      </button>

      {/* Title (stable) */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg md:text-xl font-semibold text-white">All Badges</h1>
        <div className="h-[6px] w-28 rounded-full" style={{ background: "var(--hero-grad)" }} />
      </div>

      {/* Grid (always rendered; no loading swap) */}
      <div className="mt-6">
        <BadgeGrid badges={badges} onBadgeClick={(b) => setSelectedBadge(b)} />
      </div>

      {/* Modal (wrapper always present, hidden when closed) */}
      <BadgeModal badge={selectedBadge} onClose={() => setSelectedBadge(null)} />
    </div>
  );
}
