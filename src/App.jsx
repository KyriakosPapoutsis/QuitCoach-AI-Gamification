// src/App.jsx
/**
 * Module: App routing & auth guards
 *
 * Purpose
 * - Defines all route paths and enforces authentication boundaries.
 * - Wraps private pages with Layout and guards them via RequireAuth.
 * - Redirects signed-in users away from public auth routes.
 *
 * Key components
 * - AppLayout: wraps pages in the main Layout shell.
 * - RequireAuth: waits for Firebase auth, gates private routes.
 * - PublicOnly: inverse guard for SignIn/SignUp routes.
 *
 * Routing notes
 * - Uses react-router-dom (v6) <Routes> + nested <Outlet>.
 * - Falls back to /signin for unknown paths.
 */

import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/firebase";

import Layout from "@/components/layout";
import Dashboard from "@/pages/Dashboard";
import DailyLog from "@/pages/DailyLog";
import Challenges from "@/pages/Challenges";
import Community from "@/pages/Community";
import AIChat from "@/pages/AIChat";
import Audio from "@/pages/Audio";
import Profile from "@/pages/Profile";
import BadgesPage from "@/pages/BadgesPage";
import ChallengesHistory from "@/pages/ChallengesHistory";
import SignIn from "@/pages/SignIn";
import SignUp from "@/pages/SignUp";
import NotificationsPage from "@/pages/Notifications";

function AppLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function RequireAuth() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setReady(true);
    });
    return () => unsub();
  }, []);

  // Keep element type stable
  if (!ready) return <div data-role="auth-gate" />;

  return user ? <Outlet /> : <Navigate to="/signin" replace />;
}

function PublicOnly() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setReady(true);
    });
    return () => unsub();
  }, []);

  if (!ready) return <div data-role="public-gate" />;

  return user ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export default function App() {
  return (
    <Routes>
      {/* Public auth pages (and redirect away if authed) */}
      <Route element={<PublicOnly />}>
        <Route path="/" element={<Navigate to="/signin" replace />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
      </Route>

      {/* Private app pages (only render when authed) */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dailylog" element={<DailyLog />} />
          <Route path="/challenges" element={<Challenges />} />
          <Route path="/community" element={<Community />} />
          <Route path="/aichat" element={<AIChat />} />
          <Route path="/audio" element={<Audio />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/badges" element={<BadgesPage />} />
          <Route path="/challenges/history" element={<ChallengesHistory />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  );
}
