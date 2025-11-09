/**
 * SignIn.jsx
 * ------------
 * Purpose: Sign-in screen for existing users. Handles email/password
 *          authentication and ensures a user document exists in Firestore.
 *
 * Data Flow:
 * - Uses Firebase Auth (signInWithEmailAndPassword)
 * - Calls ensureUserDocument() to create/update user record.
 * - Navigates to the Dashboard on success.
 *
 * UI / UX:
 * - Glassmorphic card with random gradient theme per mount.
 * - Password visibility toggle and inline error handling.
 * - Link to Sign Up for new users.
 * - InkHeroCanvas background for consistent animated look.
 *
 * Dev Notes:
 * - Background themes rotate on mount for variety.
 * - Errors are displayed inline in a soft red alert box.
 * - Uses createPageUrl() for consistent internal navigation.
 */

import React from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Sparkles } from "lucide-react";
import { auth } from "@/firebase";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { ensureUserDocument } from "@/services/users";
import { createPageUrl } from "@/utils";
import InkHeroCanvas from "@/components/InkHeroCanvas";

const THEMES = [
  "linear-gradient(135deg, #42275a 0%, #734b6d 100%)", // purple
  "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)", // deepblue
  "linear-gradient(135deg, #134E5E 0%, #2d793e 100%)", // forest
  "linear-gradient(135deg, #f12711 0%, #966c13 100%)", // sunset
];

export default function SignIn() {
  const nav = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  // pick one random theme once per mount
  const bgGrad = React.useMemo(
    () => THEMES[Math.floor(Math.random() * THEMES.length)],
    []
  );

  async function handleEmailSignIn(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await ensureUserDocument(cred.user.uid);
      nav(createPageUrl("Dashboard"), { replace: true });
    } catch (e) {
      setErr(e.message || "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0c0f14]">
      {/* Random theme gradient backdrop */}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: bgGrad, backgroundSize: "cover", backgroundAttachment: "fixed" }}
      />
      {/* Animated ink (same as Dashboard) */}
      <InkHeroCanvas className="pointer-events-none absolute inset-0 opacity-[0.7] mix-blend-screen" />

      {/* Foreground */}
      <div className="relative z-10 flex items-center justify-center min-h-screen p-6">
        <Card
          className="
            relative w-full max-w-md rounded-[28px] overflow-hidden
            border border-white/20
            bg-white/[0.09] backdrop-blur-3xl backdrop-brightness-110
            shadow-[0_30px_120px_rgba(0,0,0,.55)]
          "
        >
          {/* frosted sheen + crisp edges; ensure radii match via inherit */}
          <div className="pointer-events-none absolute inset-0 rounded-[inherit]">
            <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/18 via-white/[0.08] to-white/[0.04] opacity-65" />
            <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.26),inset_0_-1px_0_rgba(255,255,255,0.08)]" />
          </div>

          <CardHeader className="text-center space-y-2 relative">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[.2em] text-white/70 justify-center">
              <Sparkles className="w-4 h-4" />
              Welcome back
            </div>
            <CardTitle className="text-xl md:text-2xl text-white font-semibold">
              Sign in to continue
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4 relative">
            {err ? (
              <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                {err}
              </div>
            ) : null}

            <form onSubmit={handleEmailSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-white/80">Email</Label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-11 pl-10 bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-white/40"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-white/80">Password</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 pl-10 pr-10 bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-white/40"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-2xl text-white border border-white/20 bg-[#0c0f14] hover:bg-[#111520] transition"
              >
                {loading ? "Signing in..." : (
                  <span className="inline-flex items-center gap-2">
                    Continue <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>


            <p className="text-center text-sm text-white/70">
              Don’t have an account?{" "}
              <Link className="text-white hover:underline" to={createPageUrl("SignUp")}>
                Sign up
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
