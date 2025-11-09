/**
 * Notifications.jsx
 * ------------------
 * Purpose: Lists in-app notifications such as challenge completions,
 *          streak milestones, AI tips, and community updates.
 *
 * Data:
 * - Firestore: users/{uid}/notifications (ordered by createdAt desc)
 * - Real-time listener for updates.
 *
 * Features:
 * - Shows unread count badge in nav bar.
 * - Allows marking notifications as read or clearing all.
 * - Displays type icons (e.g., trophy, flame, bell) per notification kind.
 *
 * Dev Notes:
 * - Uses observeUnreadCount() helper for live count updates.
 * - Authenticated component; waits for user before subscribing.
 * - Consistent “soft card” visual style with hover and transition effects.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge as UIBadge } from "@/components/ui/badge";
import {
  Bell,
  Trophy,
  CalendarCheck2,
  ListChecks,
  CheckCircle2,
  Check,
  ChevronLeft,
} from "lucide-react";
import { observeMyNotifications, markNotificationRead, markAllAsRead } from "@/services/notifications";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const Icons = {
  badge_unlocked: Trophy,
  daily_log: CalendarCheck2,
  daily_challenges: ListChecks,
  generic: Bell,
};

function timeAgo(d) {
  const ms = Date.now() - (d?.getTime?.() || new Date(d).getTime());
  const s = Math.max(1, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const dys = Math.floor(h / 24);
  if (dys > 0) return `${dys}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return `${s}s ago`;
}

const TYPE_STYLES = {
  badge_unlocked: {
    accent: "linear-gradient(135deg,#fbbf24, #f59e0b)",
    chipClass: "bg-amber-500/20 text-amber-200 border-amber-300/30",
  },
  daily_log: {
    accent: "linear-gradient(135deg,#34d399,#10b981)",
    chipClass: "bg-emerald-500/20 text-emerald-200 border-emerald-300/30",
  },
  daily_challenges: {
    accent: "linear-gradient(135deg,#818cf8,#6366f1)",
    chipClass: "bg-indigo-500/20 text-indigo-200 border-indigo-300/30",
  },
  generic: {
    accent: "linear-gradient(135deg,#9ca3af,#6b7280)",
    chipClass: "bg-slate-500/20 text-slate-200 border-slate-300/30",
  },
};

function ctaFor(n) {
  switch (n.type) {
    case "daily_log":
      return { to: createPageUrl("DailyLog"), label: "Go to Daily Log" };
    case "daily_challenges":
      return { to: createPageUrl("Challenges"), label: "Go to Challenges" };
    case "badge_unlocked":
      return { to: createPageUrl("Challenges"), label: "See Your Badges" };
    default:
      return null;
  }
}

export default function NotificationsPage() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const unsub = observeMyNotifications(setItems);
    return () => unsub && unsub();
  }, []);

  const unreadCount = useMemo(() => items.filter(i => !i.read).length, [items]);

  return (
    <div className="min-h-screen bg-[#0c0f14] text-white">
      {/* same styles as before */}
      <style>{`
        .glass {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.14);
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
        }
        .glass-strong {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18);
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
        }
        .btn-glass {
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.20);
        }
        .btn-grad {
          background: var(--hero-grad, linear-gradient(145deg, #6e34f5 0%, #9a3df2 40%, #ff7b3d 100%));
          border: 1px solid rgba(255,255,255,0.22);
        }
        .ring-grad::before {
          content: "";
          position: absolute;
          inset: -1px;
          z-index: 0;
          border-radius: 16px;
          background: linear-gradient(145deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06));
          -webkit-mask:
            linear-gradient(#000 0 0) padding-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
                  mask-composite: exclude;
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Title only (actions moved to toolbar below) */}
        <div className="flex items-center justify-start mb-3">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Notifications
          </h1>
        </div>

        {/* NEW: prominent toolbar under the title */}
        <div className="mb-6">
          <div className="glass rounded-2xl p-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Link to={createPageUrl("Dashboard")} className="w-full sm:w-auto">
              <Button
                variant="ghost"
                className="btn-glass w-full sm:w-auto rounded-full h-10 px-3 hover:bg-white/15 transition justify-center"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back to Dashboard
              </Button>
            </Link>

            <Button
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              className={`rounded-full h-10 px-3 justify-center ${
                unreadCount > 0 ? "btn-grad hover:opacity-95" : "btn-glass opacity-60"
              }`}
              title={unreadCount > 0 ? "Mark all as read" : "No unread notifications"}
            >
              <Check className="w-4 h-4 mr-2" />
              {unreadCount > 0 ? `Mark all read (${unreadCount})` : "All caught up"}
            </Button>
          </div>
        </div>

        {/* List */}
        <Card className="glass-strong rounded-2xl">
          <CardHeader>
            <CardTitle className="text-white/90">Your notifications</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {items.length === 0 && (
              <div className="text-white/60 text-sm">No notifications yet.</div>
            )}

            {items.map((n) => {
              const Icon = Icons[n.type] || Icons.generic;
              const sty = TYPE_STYLES[n.type] || TYPE_STYLES.generic;
              const cta = ctaFor(n);

              return (
                <div
                  key={n.id}
                  className="relative overflow-hidden p-3 rounded-2xl border glass group transition-transform hover:-translate-y-[1px]"
                  style={{ borderColor: "rgba(255,255,255,0.14)" }}
                >
                  <div
                    className="pointer-events-none absolute -inset-8 opacity-[0.10] blur-2xl"
                    style={{ background: sty.accent }}
                  />
                  <div className="relative z-10 flex items-start gap-3">
                    <div className="relative shrink-0">
                      <div className="absolute -inset-0.5 rounded-2xl opacity-30 blur-md" style={{ background: sty.accent }} />
                      <div className="relative w-11 h-11 rounded-2xl border bg-white/10 flex items-center justify-center ring-grad">
                        <Icon className="w-5 h-5" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate">{n.title}</div>
                        {!n.read && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${sty.chipClass}`}>
                            New
                          </span>
                        )}
                        <div className="text-xs text-white/50 ml-auto">{timeAgo(n.createdAt)}</div>
                      </div>

                      {n.body && <div className="text-white/80 text-sm mt-1">{n.body}</div>}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {cta && (
                          <Link to={cta.to}>
                            <Button size="sm" className="btn-grad rounded-full h-8 px-3 hover:opacity-95">
                              {cta.label}
                            </Button>
                          </Link>
                        )}
                        {!n.read ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => markNotificationRead(n.id)}
                            className="btn-glass rounded-full h-8 px-3 hover:bg-white/15"
                          >
                            Mark read
                          </Button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-white/60">
                            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                            Read
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
