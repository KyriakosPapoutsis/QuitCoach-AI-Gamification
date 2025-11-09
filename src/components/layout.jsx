// src/components/layout.jsx 
// Main app layout and bottom navigation bar (handles theming, routes, keyboard, drag interactions).

import React, { useRef, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Home, MessageCircle, Target, BarChart3, Music, Users } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase";
import { observeUserProfile } from "@/services/users";
import { applyTheme } from "@/theme";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

const PAGE_GRADIENTS = {
  "/dashboard": "bg-[#0c0f14]",
  "/dailylog": "bg-[#0c0f14]",
  "/challenges": "bg-[#0c0f14]",
  "/community": "bg-[#0c0f14]",
  "/aichat": "bg-[#0c0f14]",
  "/audio": "bg-[#0c0f14]",
  "/profile": "bg-[#0c0f14]",
};
const DEFAULT_GRADIENT =
  "bg-[#0c0f14]";

const navigationItems = [
  { title: "Dashboard", url: createPageUrl("Dashboard"), icon: Home, color: "from-blue-500 to-cyan-500", activeColor: "text-cyan-300" },
  { title: "Daily Log", url: createPageUrl("DailyLog"), icon: BarChart3, color: "from-green-500 to-emerald-500", activeColor: "text-emerald-300" },
  { title: "Challenges", url: createPageUrl("Challenges"), icon: Target, color: "from-orange-500 to-red-500", activeColor: "text-rose-300" },
  { title: "Community", url: createPageUrl("Community"), icon: Users, color: "from-yellow-500 to-amber-500", activeColor: "text-amber-300" },
  { title: "AI Coach", url: createPageUrl("AIChat"), icon: MessageCircle, color: "from-purple-500 to-pink-500", activeColor: "text-pink-300" },
];

export default function Layout({ children }) {
  const location = useLocation();
  const path = location.pathname.toLowerCase();
  const bgGradient = PAGE_GRADIENTS[path] ?? DEFAULT_GRADIENT;
  const navigate = useNavigate();


  // expose nav height only on AI Coach
  const bottomNavRef = React.useRef(null);
  const AI_CHAT_PATH = createPageUrl("AIChat").toLowerCase();

  // tray + items
  const trayRef = useRef(null);
  const itemRefs = useRef([]);

  // dragging bubble
  const [scrubbing, setScrubbing] = useState(false);
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 });

  // cached icon centers (clientX)
  const centersRef = useRef([]);

  const [activeUrlOverride, setActiveUrlOverride] = useState(null);

  const pathForActive = activeUrlOverride ?? location.pathname;

  const measureCenters = useCallback(() => {
    centersRef.current = itemRefs.current.map((el) => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
  }, []);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const pointerToTrayPos = (e) => {
    const t = trayRef.current.getBoundingClientRect();
    return { x: e.clientX - t.left, y: e.clientY - t.top, rect: t };
  };

  const nearestIndexByClientX = (clientX) => {
    let best = 0, bestDist = Infinity;
    centersRef.current.forEach((cx, i) => {
      const d = Math.abs(clientX - cx);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };

  const cssNumber = (prop, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(prop);
    const num = parseFloat(v);
    return Number.isFinite(num) ? num : fallback;
  };

  const DRAG_THRESHOLD = 8; // px before we treat it as a drag
  const dragStartRef = useRef({ x: 0, y: 0, id: null });
  const EDGE_SLACK = 10; // px beyond inner bounds allowed for the bubble

  const startScrub = (e) => {
    // DO NOT set scrubbing yet; wait to see if the user actually drags
    dragStartRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    // no preventDefault here so a simple tap can click the Link normally
  };


  const moveScrub = (e) => {
    if (!trayRef.current) return;

    // If we haven't started scrubbing yet, check drag distance
    if (!scrubbing) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // still a tap, not a drag

      // Start scrubbing NOW
      measureCenters();
      setScrubbing(true);
      trayRef.current.setPointerCapture?.(dragStartRef.current.id);
    }

    // Update bubble position while scrubbing
    const { x, rect } = pointerToTrayPos(e);
    const pw = cssNumber("--pill-w", 96);
    const ph = cssNumber("--pill-h", 64);
    const xClamped = clamp(x - pw / 2, -EDGE_SLACK, rect.width - pw + EDGE_SLACK); const yCentered = (rect.height - ph) / 2;
    setBubblePos({ x: xClamped, y: yCentered });
  };


  const endScrub = (e) => {
    if (!scrubbing) return;

    // don't drop scrubbing yet (avoids old-pill flash)
    try { trayRef.current?.releasePointerCapture?.(e.pointerId); } catch { }

    const idx = nearestIndexByClientX(e.clientX);
    const to = navigationItems[idx]?.url;

    if (to && to !== location.pathname) {
      setActiveUrlOverride(to);   // pretend we’re already on the target
      navigate(to);               // trigger route change
      // drop scrubbing on the next frame so the old pill never shows
      requestAnimationFrame(() => setScrubbing(false));
    } else {
      setScrubbing(false);
    }
  };

  React.useEffect(() => {
    let unsubProfile;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }

      if (u) {
        // one-time immediate apply
        getDoc(doc(db, "users", u.uid)).then((snap) => {
          const theme = snap.exists() ? snap.data().theme || "forest" : "forest";
          applyTheme(theme);
        });

        // live updates
        unsubProfile = observeUserProfile(u.uid, (profile) => {
          applyTheme(profile?.theme || "forest");
        });
      } else {
        applyTheme("forest");
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);


  // Expose --bottom-nav-height only on AI Coach route
  React.useEffect(() => {
    const navEl = bottomNavRef.current;
    if (!navEl) return;

    const root = document.documentElement;
    const setVar = () => {
      const onAIChat = location.pathname.toLowerCase() === AI_CHAT_PATH;
      if (onAIChat) {
        root.style.setProperty("--bottom-nav-height", `${navEl.offsetHeight}px`);
      } else {
        root.style.removeProperty("--bottom-nav-height");
      }
    };

    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(navEl);
    window.addEventListener("resize", setVar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
    };
  }, [location.pathname, AI_CHAT_PATH]);


  React.useEffect(() => {
    const root = document.documentElement;

    const show = (h = 0) => {
      root.classList.add("kb-open");
      root.style.setProperty("--kb-height", `${Math.max(0, Math.round(h))}px`);
    };
    const hide = () => {
      root.classList.remove("kb-open");
      root.style.removeProperty("--kb-height");
    };

    let unsub = [];
    if (Capacitor.isNativePlatform() && Keyboard) {
      // Prefer content resize so inputs aren't covered (safe on Android/iOS)
      Keyboard.setResizeMode?.({ mode: "body" }).catch(() => { });
      unsub.push(Keyboard.addListener("keyboardWillShow", e => show(e?.keyboardHeight || 0)));
      unsub.push(Keyboard.addListener("keyboardDidShow", e => show(e?.keyboardHeight || 0)));
      unsub.push(Keyboard.addListener("keyboardWillHide", hide));
      unsub.push(Keyboard.addListener("keyboardDidHide", hide));
    } else if (window.visualViewport) {
      const vv = window.visualViewport;
      const onVV = () => {
        // Heuristic: when viewport shrinks by >100px, assume keyboard
        const delta = window.innerHeight - (vv.height + vv.offsetTop);
        delta > 100 ? show(delta) : hide();
      };
      vv.addEventListener("resize", onVV);
      vv.addEventListener("scroll", onVV);
      // initial check
      onVV();
      unsub.push({ remove: () => { vv.removeEventListener("resize", onVV); vv.removeEventListener("scroll", onVV); } });
    }

    return () => { unsub.forEach(u => u?.remove?.()); hide(); };
  }, []);


  React.useEffect(() => {
    if (activeUrlOverride && location.pathname === activeUrlOverride) {
      setActiveUrlOverride(null);
    }
  }, [location.pathname, activeUrlOverride]);




  // keep centers in sync on resize
  React.useEffect(() => {
    const onResize = () => measureCenters();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureCenters]);

  return (
    <div className={`min-h-screen ${bgGradient} text-white`}>
      <style>
        {`
          :root {
            --primary: 139 92 246;
            --primary-foreground: 255 255 255;
            --background: 15 23 42;
            --card: 30 41 59;
            --border: 71 85 105;

            /* bubble size */
            --pill-w: clamp(4.4rem, 17vw, 6rem);
            --pill-h: clamp(3.4rem, 14vw, 4.5rem);
          }

          .glass {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          .glass-dark {
            background: rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          .glass-colored {
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }

          .frost-tray {
            touch-action: none;
            width: clamp(360px, 96vw, 720px);
            border-radius: 9999px;
            padding: 8px 14px;
            background: rgba(255,255,255,0.06);
            backdrop-filter: blur(24px) saturate(160%);
            -webkit-backdrop-filter: blur(24px) saturate(160%);
            border: 1px solid rgba(255,255,255,0.22);
            box-shadow: 0 10px 28px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,0.08);
            position: relative;
            overflow: hidden;
          }
          .frost-tray::before{
            content:"";position:absolute;inset:-10%;border-radius:9999px;
            background:conic-gradient(from 0deg,rgba(255,120,120,.20),rgba(120,150,255,.20),rgba(120,255,185,.20),rgba(255,120,210,.20),rgba(255,120,120,.20));
            filter:blur(18px) saturate(180%);mix-blend-mode:screen;opacity:.25;pointer-events:none;
          }

          /* icons grid sits below the bubble */
          .tray-grid{ position: relative; z-index: 1; }

          /* moving bubble while dragging */
          .scrub-bubble{
          position:absolute; left:0; top:0;
          width: var(--pill-w); height: var(--pill-h);
          border-radius:9999px; pointer-events:none;
          backdrop-filter: blur(28px) saturate(185%) contrast(1.12);
          -webkit-backdrop-filter: blur(28px) saturate(185%) contrast(1.12);
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.30);
          box-shadow: 0 10px 28px rgba(0,0,0,.38), 0 0 26px rgba(140,170,255,.30);
          transform: translate(var(--x, 0px), var(--y, 0px));
          transition: transform 90ms ease-out;
          overflow:hidden;
          z-index: 5;                 
          will-change: transform, backdrop-filter; 
}
          .scrub-bubble::before{
          content:"";position:absolute;inset:-2px;border-radius:inherit;
          background:conic-gradient(from 0deg,
          rgba(255,120,120,.30), rgba(120,150,255,.30),
          rgba(120,255,185,.30), rgba(255,120,210,.30),
          rgba(255,120,120,.30));
          filter:blur(12px) saturate(200%);
          mix-blend-mode:screen; opacity:.45;
}
          .scrub-bubble::after{
          content:"";position:absolute;inset:0;
          background:
          radial-gradient(110% 100% at 10% 0%, rgba(255,255,255,.22), transparent 55%),
          linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.03));
}

          /* fixed ACTIVE pill (only when not scrubbing) */
          .frost-chip{
            width: var(--pill-w);
            height: var(--pill-h);
            border-radius: 9999px;
            background: rgba(255,255,255,0.10);
            backdrop-filter: blur(26px) saturate(180%);
            -webkit-backdrop-filter: blur(26px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.28);
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.35rem;
            position:relative;overflow:hidden;padding:8px 10px;
            transition: transform .16s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease;
          }
          .frost-chip::before{
            content:"";position:absolute;inset:-2px;border-radius:inherit;
            background:conic-gradient(from 0deg,rgba(255,120,120,.30),rgba(120,150,255,.30),rgba(120,255,185,.30),rgba(255,120,210,.30),rgba(255,120,120,.30));
            filter:blur(12px) saturate(200%);mix-blend-mode:screen;opacity:.5;pointer-events:none;
          }
          .frost-chip::after{
            content:"";position:absolute;inset:0;
            background:radial-gradient(110% 100% at 10% 0%,rgba(255,255,255,.26),transparent 55%),linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.03));
          }
          .frost-chip.active{
            background:rgba(255,255,255,0.20); border-color:rgba(255,255,255,0.42);
            box-shadow:0 10px 28px rgba(0,0,0,.38), 0 0 26px rgba(140,170,255,.40);
          }

          .tray-item{ display:flex;flex-direction:column;align-items:center;gap:.5rem; padding:6px 10px; }          .pill-icon{ width:clamp(20px,5vw,24px); height:clamp(20px,5vw,24px); }
          .frost-label-inside, .tray-label{ font-size:clamp(10px,2.8vw,12px); line-height:1; white-space:nowrap; }

          @media (max-width: 768px) {
            .mobile-safe { padding-bottom: env(safe-area-inset-bottom); }
          }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 2px; }
        `}
      </style>

      <main className="pb-24">{children}</main>

      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="hero-gradient-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" />
            <stop offset="50%" />
            <stop offset="100%" />
          </linearGradient>
        </defs>
      </svg>



      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav fixed bottom-3 left-0 right-0 z-50">
        <div className="w-full flex justify-center mobile-safe px-3">
          <div
            className="frost-tray"
            ref={trayRef}
            onPointerDown={startScrub}
            onPointerMove={moveScrub}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onPointerLeave={endScrub}
          >
            {/* Floating bubble while scrubbing */}
            {scrubbing && (
              <div
                className="scrub-bubble"
                style={{ ['--x']: `${bubblePos.x}px`, ['--y']: `${bubblePos.y}px` }}
              />
            )}

            <div
              className="tray-grid grid gap-4 place-items-center"
              style={{ gridTemplateColumns: `repeat(${navigationItems.length}, minmax(0, 1fr))` }}
            >
              {navigationItems.map((item, idx) => {
                const isActive = pathForActive === item.url;
                return (
                  <Link
                    key={item.title}
                    to={item.url}
                    ref={(el) => (itemRefs.current[idx] = el)}
                    onClickCapture={(e) => { if (scrubbing) e.preventDefault(); }}
                    className={`rounded-2xl transition-transform duration-150 ${isActive && !scrubbing ? "scale-105" : "hover:opacity-95"}`}
                  >
                    {/* Hide fixed pill during drag so you only see the moving bubble */}
                    {isActive && !scrubbing ? (
                      <div className="frost-chip active">
                        <item.icon
                          className="pill-icon hero-icon-glow"
                          style={{ stroke: "var(--hero-grad-first)" }}
                        />
                        <span
                          className="frost-label-inside hero-accent-glow"
                          style={{ color: "var(--hero-grad-first)" }}
                        >
                          {item.title}
                        </span>
                      </div>
                    ) : (
                      <div className="tray-item">
                        <item.icon className="pill-icon text-white/85" />
                        <span className="tray-label text-white/75">{item.title}</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}
