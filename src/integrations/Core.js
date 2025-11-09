// src/integrations/Core.js
// Central helper for communicating with backend AI endpoints (chat or JSON).
// Wraps fetch calls with Firebase auth and provides a single InvokeLLM() method
// used throughout the app for AI-driven responses.

import { getFirebaseIdToken } from "@/firebase";

function apiUrl(path) {
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/,"");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
// POST with Firebase authentication.
async function authPost(path, body) {
  const token = await getFirebaseIdToken(true); // force refresh
  if (!token) throw new Error("No Firebase ID token. Is the user signed in?");
  const r = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}\n${await r.text()}`);
  return r.json();
}

// Invoke the backend LLM endpoint.
// - With a JSON schema → calls /api/ai/json
// - Otherwise → calls /api/ai/chat
// Returns text content or { conversationId, text } if the backend includes it.
export async function InvokeLLM({ prompt, response_json_schema, conversationId } = {}) {
  if (response_json_schema) {
    const system = `You are a quit-smoking coach. Return JSON that matches this shape exactly: ${JSON.stringify(response_json_schema)}. No extra text.`;
    return authPost("/api/ai/json", { system, prompt });
  }

  const payload = conversationId
    ? { conversationId, message: prompt }
    : {
        messages: [
          { role: "system", content: "You are an encouraging quit-smoking coach." },
          { role: "user", content: prompt || "Say hello in one sentence." },
        ],
      };

  const data = await authPost("/api/ai/chat", payload);
  const text = data.reply ?? data.content ?? data.text ?? "";
  return data.conversationId ? { conversationId: data.conversationId, text } : text;
}