// chatApi.js — brief summary:
// Helper functions for calling the app’s backend AI and related endpoints.
// Handles Firebase auth tokens, JSON requests, and common chat-related routes.
// Used by AI Coach, challenge generation, and other features requiring LLM responses.

import { getFirebaseIdToken } from "@/firebase";

function apiUrl(path) {
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/,"");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

// Authenticated fetch wrapper using Firebase ID token.
export async function authFetch(path, options = {}) {
  const token = await getFirebaseIdToken(true);   // refresh OK
  if (!token) throw new Error("Not signed in");   // block when logged out

  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${body}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// Default API paths (adjust if backend routes differ)
const PATHS = {
    chat: "/api/ai/chat",                 
    conversations: "/api/conversations",  
    messages: "/api/messages",            
};

// Send a chat message to the AI coach.
// Returns { conversationId, reply } from the backend.
export async function sendChat({ conversationId, userMessage }) {
    const msg = (userMessage ?? "").trim();
    if (!msg) throw new Error("Type a message first.");
    const data = await authFetch("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId, userMessage: msg }), 
    });
    return data; 
}

// Retrieve a user’s saved chat conversations.
export async function listConversations() {
    return authFetch(PATHS.conversations);
}
// Retrieve all messages in a specific conversation.
export async function getMessages(conversationId) {
    const qs = `?conversationId=${encodeURIComponent(conversationId)}`;
    return authFetch(`${PATHS.messages}${qs}`);
}
// Generate new daily challenges through AI.
export async function generateChallenges(count = 3) {
  return authFetch("/api/ai/generate-challenges", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
}

// Dev log for debugging API base URL
console.log('VITE_API_URL =', import.meta.env.VITE_API_URL);
console.log('fetching:', apiUrl('/api/health'));