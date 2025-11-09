/**
 * AIChat.jsx
 * -----------
 * Purpose: Conversational “AI Coach” chat page with a sticky input bar and
 *          themed bubbles. Optionally prefilled from navigation state/query.
 *
 * Data Flow:
 * - Reads the signed-in user (Firebase Auth) and their profile doc for
 *   avatar + theme color (Firestore: users/{uid}).
 * - Loads the most recent conversation/messages via your REST API
 *   (listConversations/getMessages from integrations/chatApi).
 * - Sends user input with sendChat(); appends assistant reply to UI.
 * - After each send, increments metrics and evaluates badges.
 *
 * Key UI:
 * - Animated gradient header, scrollable message list, auto-growing textarea.
 * - Distinct styling for user vs assistant bubbles; optional user avatar.
 *
 * Dev Notes:
 * - Prefill support: `navigate('/ai?prefill=...')` or `navigate('/ai', {state:{prefill}})`.
 * - Keeps input wrapper height in sync with scrollable area.
 * - Uses the same theme color (var(--hero-grad-first)) as navbar/icons.
 */

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bot, User as UserIcon, Send, Music } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import InkHeroCanvas from "@/components/InkHeroCanvas";
import { sendChat, listConversations, getMessages } from "@/integrations/chatApi";
import { auth, db } from "@/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { incAiMessages } from "@/services/metrics";
import { evaluateAndUnlockBadges } from "@/services/badges";
import { useLocation, useSearchParams } from "react-router-dom";

const pillBtn =
  "rounded-full bg-white/10 hover:bg-white/15 text-white border border-white/20 backdrop-blur-md";

function normalizeAvatar(value) {
  if (!value) return null;
  const s = String(value);
  if (/^https?:\/\//i.test(s) || s.startsWith("/") || s.startsWith("data:")) return s;
  const hasExt = /\.(png|jpe?g|gif|webp|svg)$/i.test(s);
  return `/avatars/${hasExt ? s : `${s}.png`}`;
}

function hexToRgba(hex, a = 0.18) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return `rgba(255,255,255,${a})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function AIChat() {
  const NAV_H = 56; // px (matches your 14 * 4)

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { id: "m1", role: "assistant", text: "Hey! I’m your AI Coach. Tell me what’s on your mind and I’ll guide you step by step." },
  ]);
  const [conversationId, setConversationId] = useState(null);
  const [isSending, setIsSending] = useState(false);

  const endRef = useRef(null);
  const mainRef = useRef(null);

  const inputWrapRef = useRef(null);
  const textareaRef = useRef(null);
  const [inputWrapH, setInputWrapH] = useState(88); // initial guess (px)

  const [userAvatarUrl, setUserAvatarUrl] = useState(null);
  const [theme, setTheme] = useState("#6e34f5"); // will be replaced by user's theme

  const hasText = input.trim().length > 0;

  // const inputRef = useRef(null); // not used anymore; textareaRef is the one we focus
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const hydrated = useRef(false); // only hydrate once

  const MAX_ROWS = 6;
  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // roughly line-height ~ 20px + padding; cap at ~6 rows
    const maxPx = 6 * 24; // adjust if your line-height differs
    const next = Math.min(el.scrollHeight, maxPx);
    el.style.height = `${next}px`;
  };

  // Keep main bottom spacing in sync with wrapper height
  const measureInputWrap = () => {
    const node = inputWrapRef.current;
    if (!node) return;
    setInputWrapH(Math.ceil(node.getBoundingClientRect().height));
  };


  useEffect(() => {
    if (hydrated.current) return;
    const fromState = location.state?.prefill;
    const fromQuery = searchParams.get("prefill");
    const txt = (fromState || fromQuery || "").toString().trim();
    if (txt) {
      setInput(txt);
      hydrated.current = true;
      // focus & size after paint for nicer UX
      setTimeout(() => {
        textareaRef.current?.focus?.();
        resizeTextarea();
        measureInputWrap();
      }, 0);
    }
  }, [location.state, searchParams]);

  useEffect(() => {
    let unsubAuth = () => { };
    let unsubDoc = () => { };
    unsubAuth = auth.onAuthStateChanged((u) => {
      unsubDoc?.();
      if (!u?.uid) {
        setUserAvatarUrl(null);
        return;
      }
      const ref = doc(db, "users", u.uid);
      unsubDoc = onSnapshot(ref, (snap) => {
        const d = snap.data() || {};
        const fromDbAvatar = d.photoURL || d.photoUrl || d.avatarUrl || null;
        const fromAuthAvatar = u.photoURL || null;
        setUserAvatarUrl(normalizeAvatar(fromDbAvatar) || normalizeAvatar(fromAuthAvatar));

        const userTheme =
          d.themeColor || d.theme || d.primaryColor || d.accentColor || null;
        if (typeof userTheme === "string" && userTheme.trim()) {
          setTheme(userTheme.trim());
        }
      });
    });
    return () => {
      unsubDoc?.();
      unsubAuth?.();
    };
  }, []);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: "smooth" });
    // input wrapper may change when messages trigger reflow
    measureInputWrap();
  }, [messages.length]);

  useEffect(() => {
    resizeTextarea();
    measureInputWrap();
  }, [input]);

  useEffect(() => {
    (async () => {
      const convos = await listConversations();
      if (convos[0]) {
        const msgs = await getMessages(convos[0].id);
        setMessages([
          { id: "sys", role: "assistant", text: "Welcome back!" },
          ...msgs.map((m) => ({ id: m.id, role: m.role, text: m.content })),
        ]);
        setConversationId(convos[0].id);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "auto" }), 0);
      }
    })().catch(console.error);
  }, []);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userMsg = { id: crypto.randomUUID(), role: "user", text: trimmed };
    const typingId = `typing-${crypto.randomUUID()}`;
    const typingMsg = { id: typingId, role: "assistant", text: "...", typing: true };

    setMessages((m) => [...m, userMsg, typingMsg]);
    setInput("");
    setIsSending(true);

    try {
      const { conversationId: cid, reply } = await sendChat({ conversationId, userMessage: trimmed });
      if (!conversationId) setConversationId(cid);

      setMessages((m) => {
        const withoutTyping = m.filter((x) => x.id !== typingId);
        return [...withoutTyping, { id: crypto.randomUUID(), role: "assistant", text: reply }];
      });
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch (e) {
      setMessages((m) => {
        const withoutTyping = m.filter((x) => x.id !== typingId);
        return [...withoutTyping, { id: crypto.randomUUID(), role: "assistant", text: `Error: ${e.message}` }];
      });
    } finally {
      setIsSending(false);
    }

    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        await incAiMessages(uid, 1);
        await evaluateAndUnlockBadges(uid);
      } catch (e) {
        console.warn("Post-send metrics/badges failed:", e);
      }
    }


  };

  return (
    <div
      className="fixed inset-0 bg-[#0c0f14] text-white"
      style={{
        ["--nav-h"]: `${NAV_H}px`,
        ["--bottom-gap"]: "3.5rem",
        ["--theme"]: theme, // from user profile
      }}
    >
      <header className="fixed top-0 inset-x-0 h-14 hero-wrap">
        <InkHeroCanvas />
        <div className="relative h-full px-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">AI Coach</h1>
          <Link to={createPageUrl("Audio")}>
            <button className={`${pillBtn} px-4 py-2 inline-flex items-center gap-2`}>
              <Music className="w-4 h-4" />
              Hypnosis Sessions
            </button>
          </Link>
        </div>
      </header>

      <main
        ref={mainRef}
        className="absolute inset-x-0 overflow-y-auto px-4 py-3 space-y-3"
        style={{
          top: "3.5rem",
          // leave room for the dynamic input wrapper + a small gap
          bottom: `calc(${inputWrapH}px + var(--nav-h, 56px) + 16px)`,
          paddingBottom: "0.5rem",
        }}
      >
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role}
            text={m.text}
            typing={m.typing}
            avatarUrl={m.role === "user" ? userAvatarUrl : undefined}
          />
        ))}
        <div style={{ height: "var(--bottom-gap)" }} />
        <div ref={endRef} />
      </main>

      <div
        ref={inputWrapRef}
        className="fixed inset-x-0 px-4" style={{
          bottom: "calc(var(--nav-h, 56px) + 1.5rem)", // same nudge, wrapper will size itself
          zIndex: 60,                             // ensure above navbar
        }}
      >
        <div
          className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-2.5 flex items-center gap-3 shadow-[0_0_15px_rgba(255,255,255,0.08)]"
        >
          <textarea
            rows={1}
            ref={textareaRef}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 outline-none px-3 py-2 rounded-xl
                      border border-white/10 focus:border-white/30 focus:ring-1 focus:ring-white/20 transition"
            placeholder="Ask your coach anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={resizeTextarea}
            style={{ maxHeight: 144, overflowY: "auto" }}  // 6-ish rows cap
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
            }}
          />
          <Button
            onClick={send}
            disabled={isSending}
            className={`rounded-full h-11 w-11 flex items-center justify-center border backdrop-blur-md transition shadow-[0_0_12px_rgba(255,255,255,0.15)] disabled:opacity-50
        ${hasText ? "hover:brightness-110" : "hover:bg-white/20"}`}
            style={
              hasText
                ? { backgroundColor: "var(--hero-grad-first)", borderColor: "var(--hero-grad-first)" }
                : { backgroundColor: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.20)" }
            }
            aria-label="Send"
          >
            <Send className="w-5 h-5 text-white" />
          </Button>
        </div>
        <div className="mt-1.5 h-10 text-[11px] text-white/60 text-center">AI Coach is for informational support only; not a substitute for professional medical advice.</div>
      </div>

      <style>{`
        .hero-wrap {
          overflow: hidden;
          background: linear-gradient(145deg, #6e34f5 0%, #9a3df2 40%, #ff7b3d 100%);
        }
      `}</style>
    </div>
  );
}

// Use the SAME color as your navbar icons: var(--hero-grad-first)
function MessageBubble({ role, text, avatarUrl, typing }) {
  const isUser = role === "user";
  const [src, setSrc] = React.useState(avatarUrl || null);

  React.useEffect(() => { setSrc(avatarUrl || null); }, [avatarUrl]);

  const userStyle = {
    backgroundColor: "var(--hero-grad-first, #6e34f5)",
    border: "1px solid var(--hero-grad-first, #6e34f5)",
  };
  const aiStyle = {
    // lighter tint of the same theme color for assistant
    background: "color-mix(in srgb, var(--hero-grad-first, #6e34f5) 16%, transparent)",
    border: "1px solid rgba(255,255,255,0.10)",
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 text-white"
        style={isUser ? userStyle : aiStyle}
      >
        <div className="flex items-start gap-2">
          <div
            className="w-7 h-7 rounded-full border border-white/20 flex items-center justify-center shrink-0 overflow-hidden"
            style={{ backgroundColor: isUser ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)" }}
          >
            {isUser ? (
              src ? (
                <img
                  src={src}
                  alt="You"
                  className="w-full h-full object-cover"
                  onError={() => setSrc("/avatars/default.png")}
                />
              ) : (
                <UserIcon className="w-4 h-4 text-white/90" />
              )
            ) : (
              <Bot className="w-4 h-4 text-white/85" />
            )}
          </div>

          {typing ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse [animation-delay:200ms]">.</span>
                <span className="animate-pulse [animation-delay:400ms]">.</span>
              </span>
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
          )}
        </div>
      </div>
    </div>
  );
}

