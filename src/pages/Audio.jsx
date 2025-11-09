/**
 * Audio.jsx
 * ----------
 * Purpose: Simple library of short hypnosis/relaxation audio sessions with
 *          play/pause controls and lightweight progress tracking.
 *
 * Behavior:
 * - Local static session list (id, title, src, duration).
 * - Single-play policy: starting one session pauses any other.
 * - On successful play: increments audio-session metric and evaluates badges.
 *
 * Dependencies:
 * - Firebase Auth for current uid (metrics/badges).
 * - incAudioSessions() + evaluateAndUnlockBadges() side effects.
 *
 * UX Details:
 * - Soft-glass cards per session, inline description, duration label.
 * - “Back to AI Coach” button returns to /aichat.
 *
 * Dev Notes:
 * - Audio elements are hidden (HTMLAudioElement), refs keyed by session id.
 * - Gracefully handles playback failures (autoplay policies, etc.).
 */

import React, { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Headphones, Play, Pause, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { incAudioSessions } from "@/services/metrics";
import { evaluateAndUnlockBadges } from "@/services/badges";
import { auth } from "@/firebase";

const pill =
  "rounded-full bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md text-white";

const SESSIONS = [
  { id: "morning", title: "Morning Reset", src: "/audio/morning.mp3", duration: "2 mins 33 secs" },
  { id: "afternoon", title: "Afternoon Focus", src: "/audio/afternoon.mp3", duration: "4 mins" },
  { id: "deep", title: "Evening Wind Down", src: "/audio/deep.mp3", duration: "3 mins 20 secs" },
  { id: "joy", title: "Midday Joy", src: "/audio/joy.mp3", duration: "2 mins 30 secs" },
  { id: "dusk", title: "Slow Dusk", src: "/audio/dusk.mp3", duration: "4 mins" },
  { id: "night", title: "Calming Night", src: "/audio/night.mp3", duration: "2 mins 21 secs" },
  { id: "relaxing", title: "Relaxing Comedown", src: "/audio/relaxing.mp3", duration: "3 mins 19 secs" },
  { id: "tides", title: "Ambient Tides", src: "/audio/tides.mp3", duration: "3 mins 59 secs" },
  { id: "vibe", title: "Midnight Vibe", src: "/audio/vibe.mp3", duration: "2 mins 59 secs" },
  { id: "happiness", title: "Happiness Overload", src: "/audio/happiness.mp3", duration: "3 mins 17 secs" },

];

export default function Audio() {
  const navigate = useNavigate();
  const audioRefs = useRef({});
  const [playingId, setPlayingId] = useState(null);

  const handlePlayClick = async (id) => {
    const el = audioRefs.current[id];
    if (!el) return;

    // toggle if same; pause others if different
    if (playingId && playingId !== id) {
      audioRefs.current[playingId]?.pause();
    }
    if (playingId === id && !el.paused) {
      el.pause();
      setPlayingId(null);
      return;
    }

    try {
      await el.play();
      setPlayingId(id);

      // track + unlock
      const uid = auth.currentUser?.uid;
      if (uid) {
        try {
          await incAudioSessions(uid, 1);
          await evaluateAndUnlockBadges(uid);
        } catch (e) {
          console.warn("Audio sessions/badges update failed:", e);
        }
      }
    } catch (e) {
      console.warn("Playback failed:", e);
    }
  };

  return (
    <div className="p-6 min-h-screen bg-[#0c0f14] text-white">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Back button */}
        <button
          onClick={() => navigate("/aichat")}
          className="flex items-center gap-2 rounded-full px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm backdrop-blur-md"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to AI Coach
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <Headphones className="w-14 h-14 mx-auto mb-3 text-white/80" />
          <h1 className="text-2xl font-bold">Hypnosis Sessions</h1>
          <div
            className="mt-2 mx-auto w-32 h-[6px] rounded-full"
            style={{ background: "var(--hero-grad)" }}
          />
          <p className="text-white/70 mt-3">
            Relax, reduce cravings, and stay smoke-free.
          </p>
        </div>

        {/* Sessions */}
        <div className="grid gap-5">
          {SESSIONS.map((s) => (
            <Card key={s.id} className="soft-card rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{s.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-white/70 text-sm mb-4">
                  {s.id === "morning" && "Start your day with clarity and motivation."}
                  {s.id === "afternoon" && "Re-center and lower stress during the day."}
                  {s.id === "deep" && "Relax your mind and reduce late-night cravings."}
                  {s.id === "joy" && "Boost positivity and anchor a grateful mindset."}
                  {s.id === "dusk" && "Unwind at sunset and release the day’s tension."}
                  {s.id === "night" && "Slow your breath and prepare for deep, restorative sleep."}
                  {s.id === "relaxing" && "Loosen body tension and quiet busy thoughts."}
                  {s.id === "tides" && "Breathe with musical waves to smooth out cravings."}
                  {s.id === "vibe" && "Lift your energy and focus without reaching for a cigarette."}
                  {s.id === "happiness" && "Cultivate steady joy and reward pathways without nicotine."}

                </p>
                <div className="flex items-center gap-2">
                  <Button
                    className={`${pill} px-5 py-2.5 flex items-center gap-2`}
                    onClick={() => handlePlayClick(s.id)}
                  >
                    {playingId === s.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    {playingId === s.id ? "Pause" : "Play"} Session
                  </Button>
                  <span className="text-xs text-white/50">{s.duration}</span>
                </div>

                {/* hidden audio element */}
                <audio
                  ref={(el) => (audioRefs.current[s.id] = el)}
                  src={s.src}
                  preload="auto"
                  onEnded={() => setPlayingId((pid) => (pid === s.id ? null : pid))}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
