/**
 * Profile.jsx
 * ------------
 * Purpose: User profile and settings page — displays personal data,
 *          quit details, notification preferences, and quick stats.
 *
 * Data:
 * - Firestore: users/{uid} document (profile info and stats)
 * - Reads via services/users, updates through updateUserProfile().
 *
 * Features:
 * - Editable fields: name, quit date, cost per pack, reasons, preferences.
 * - Live total_points and quit stats summary.
 * - Logout button via User.logout() helper.
 *
 * Dev Notes:
 * - Authenticated: waits for Firebase Auth state.
 * - Uses cards and grouped sections for a clean layout.
 * - updateUserProfile() syncs changes to Firestore immediately.
 */

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  User as UserIcon,
  Calendar,
  Target,
  Bell,
  Save,
  LogOut,
  ArrowLeft
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { auth } from "@/firebase";
import { observeUserProfile, updateUserProfile, uploadProfilePhoto } from "@/services/users";
import { signOut } from "firebase/auth";
import { applyTheme } from "@/theme";
import { format, startOfDay, differenceInDays } from "date-fns";
import { db } from "@/firebase";
import { doc, onSnapshot, collection, query, where, deleteField } from "firebase/firestore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { publishLeaderboardRow } from "@/services/users";

const quitReasons = [
  "Better health",
  "Save money",
  "Family/relationships",
  "Fitness goals",
  "Smell and taste",
  "Social pressure",
  "Pregnancy",
  "Doctor's advice",
];

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);
  const [profileFile, setProfileFile] = useState(null);

  const [formData, setFormData] = useState({
    quit_date: "",
    target_quit_date: "",
    cigarettes_per_day_before: "",
    cost_per_pack: "",
    cigarettes_per_pack: 20,
    quit_reasons: [],
    notification_preferences: {
      daily_reminders: true,
      milestone_alerts: true,
      challenge_notifications: true,
    },
    dashboard_theme: "forest",
    profile_image_url: "",
  });


  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeDateChoice, setActiveDateChoice] = useState("quit"); // "quit" | "target"
  const [totalPoints, setTotalPoints] = useState(0);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarChoices = [
    { key: "a1", src: "/avatars/a1.png", label: "A1" },
    { key: "a2", src: "/avatars/a2.png", label: "A2" },
    { key: "a3", src: "/avatars/a3.png", label: "A3" },
    { key: "a4", src: "/avatars/a4.png", label: "A4" },
    { key: "a5", src: "/avatars/a5.png", label: "A5" },
    { key: "a6", src: "/avatars/a6.png", label: "A6" },
    { key: "a7", src: "/avatars/a7.png", label: "A7" },
    { key: "a8", src: "/avatars/a8.png", label: "A8" },
    { key: "a9", src: "/avatars/a9.png", label: "A9" },
    { key: "a10", src: "/avatars/a10.png", label: "A10" },
    { key: "a11", src: "/avatars/a11.png", label: "A11" },
    { key: "a12", src: "/avatars/a12.png", label: "A12" },
    { key: "a13", src: "/avatars/a13.png", label: "A13" },
    { key: "a14", src: "/avatars/a14.png", label: "A14" },
    { key: "a15", src: "/avatars/a15.png", label: "A15" },
  ];
  const currentAvatar = profilePreview || user?.photoURL || "";



  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }

    const unsub = observeUserProfile(uid, (profile) => {
      if (!profile) {
        setUser(null);
        setLoading(false);
        return;
      }

      setUser({ ...profile, uid });
      setFormData((prev) => ({
        ...prev,
        quit_date: profile.quit_date || "",
        target_quit_date: profile.target_quit_date || "",
        cigarettes_per_day_before: profile.cigarettes_per_day_before ?? "",
        cost_per_pack: profile.cost_per_pack ?? "",
        cigarettes_per_pack: profile.cigarettes_per_pack ?? 20,
        quit_reasons: profile.quit_reasons || [],
        notification_preferences:
          profile.notification_preferences || {
            daily_reminders: true,
            milestone_alerts: true,
            challenge_notifications: true,
          },
        dashboard_theme: profile.theme || "forest",
      }));
      // keep the radio in sync with what's stored
      if (profile.date_mode === "target") {
        setActiveDateChoice("target");
      } else if (profile.date_mode === "quit") {
        setActiveDateChoice("quit");
      } else if (profile.quit_date) {
        setActiveDateChoice("quit");
      } else if (profile.target_quit_date) {
        setActiveDateChoice("target");
      } else {
        setActiveDateChoice("quit");
      }

      if (profile.photoURL) setProfilePreview(profile.photoURL);

      if (profile?.total_points != null) {
        setTotalPoints(profile.total_points);
      }

      setLoading(false);
    });

    return () => unsub && unsub();
  }, []);


  function computeStreakBaseline({ activeDateChoice, quit_date, target_quit_date }) {
    const today = startOfDay(new Date());

    const q = quit_date ? startOfDay(new Date(quit_date)) : null;
    const t = target_quit_date ? startOfDay(new Date(target_quit_date)) : null;

    // determine "since" date
    let since = null;
    if (activeDateChoice === "quit" && q && q <= today) since = q;
    if (activeDateChoice === "target" && t && t <= today) since = t;

    if (!since) {
      return { current_streak_days: 0, streak_start_date: null, last_slip_date: null };
    }

    const days = Math.max(0, differenceInDays(today, since));
    return {
      current_streak_days: days,
      streak_start_date: format(since, "yyyy-MM-dd"),
      last_slip_date: null,
    };
  }



  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const uid = auth.currentUser.uid;

      // theme is called "theme" in Firestore (you used dashboard_theme locally)
      await updateUserProfile(uid, {
        quit_date: formData.quit_date || null,
        target_quit_date: formData.target_quit_date || null,
        date_mode: activeDateChoice,   // persist the chosen mode
        cigarettes_per_day_before: Number(formData.cigarettes_per_day_before) || 0,
        cost_per_pack: Number(formData.cost_per_pack) || 0,
        cigarettes_per_pack: Number(formData.cigarettes_per_pack) || 20,
        quit_reasons: formData.quit_reasons || [],
        notification_preferences: formData.notification_preferences || {},
        theme: formData.dashboard_theme || "forest",
        profile_setup: true,               // set completed
      });


      // Immediately compute & persist streak baseline (no daily log needed)
      const baseline = computeStreakBaseline({
        activeDateChoice,
        quit_date: formData.quit_date,
        target_quit_date: formData.target_quit_date,
      });

      await updateUserProfile(uid, baseline);
      await publishLeaderboardRow(uid);


      // optional: if a new file picked, upload to Storage and get URL
      if (profileFile) {
        const url = await uploadProfilePhoto(uid, profileFile);
        setProfilePreview(url);
      }


      // send them to dashboard once saved
      navigate("/dashboard", { replace: true });
    } catch (err) {
      console.error("Error saving profile:", err);
    } finally {
      setSaving(false);
    }
  };


  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const toggleQuitReason = (reason) => {
    setFormData((prev) => ({
      ...prev,
      quit_reasons: prev.quit_reasons.includes(reason)
        ? prev.quit_reasons.filter((r) => r !== reason)
        : [...prev.quit_reasons, reason],
    }));
  };

  const handleNotificationChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      notification_preferences: {
        ...prev.notification_preferences,
        [key]: value,
      },
    }));
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      applyTheme("forest");            // reset theme immediately
      navigate("/signin", { replace: true });
    } catch (e) {
      console.error("Error logging out:", e);
    }
  };

  const onPickProfile = (file) => {
    if (!file) return;
    setProfileFile(file);
    const preview = URL.createObjectURL(file);
    setProfilePreview(preview);
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-purple-500 border-t-transparent animate-spin"></div>
          <p className="text-gray-300">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="px-4 overflow-x-hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
    >
      {/* Back to Dashboard */}
      <div className="mt-4 mb-6">
        <button
          onClick={() => navigate(createPageUrl("Dashboard"))}
          type="button"
          className="flex items-center gap-2 rounded-full px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm backdrop-blur-md"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
      </div>


      <div className="max-w-4xl mx-auto space-y-6 min-w-0">
        {/* Header avatar (click to pick) */}
        <div className="relative text-center mb-2">
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setAvatarOpen(true)}
              className="relative group cursor-pointer"
              title="Choose profile avatar"
            >
              <div
                className={
                  "w-24 h-24 mx-auto mb-3 rounded-full overflow-hidden flex items-center justify-center " +
                  (profilePreview
                    ? "shadow-[inset_0_0_0_2px_rgba(255,255,255,0.28)]"
                    : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]")
                }
              >
                {profilePreview ? (
                  <img src={profilePreview} alt="Profile" className="block w-full h-full object-cover" />
                ) : user?.full_name ? (
                  <span className="text-white text-2xl font-semibold">
                    {user.full_name?.charAt(0)?.toUpperCase()}
                  </span>
                ) : (
                  <UserIcon className="w-10 h-10 text-white/80" />
                )}
              </div>
              <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition">
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded-full bg-black/50 text-white">
                  Change avatar
                </div>
              </div>
            </button>

          </div>

          <h1 className="text-2xl font-bold text-white mb-1">My Profile</h1>
          <p className="text-gray-300">Manage your quit journey settings</p>
        </div>


        {/* User Info */}
        {user && (
          <Card className="glass border-white/20 overflow-hidden">
            <CardContent className="px-5 pt-2 py-4">
              <div className="flex items-end justify-between">
                <div className="min-w-0">
                  <h3 className="text-white text-base font-semibold truncate">
                    {user?.displayName || user?.username || "Unnamed"}
                  </h3>
                  <p className="text-gray-400 text-sm truncate">{user?.email}</p>
                </div>
                <div className="flex items-baseline gap-1 py-2">
                  <span className="text-xl text-white-400 leading-none">{totalPoints}</span>
                  <span className="text-xs uppercase tracking-wider text-gray-400">Points</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}



        {/* Profile Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Quit Dates */}
          <Card className="glass border-white/20 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Quit Journey Dates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6"> {/* added more vertical space between radios */}
              <div>
                <Label className="text-white mb-2 block flex items-center gap-2">
                  <input
                    type="radio"
                    name="dateChoice"
                    value="quit"
                    checked={activeDateChoice === "quit"}
                    onChange={() => setActiveDateChoice("quit")}
                    className="
                      appearance-none w-4 h-4 rounded-full cursor-pointer
                      border-2 border-white"
                    style={{
                      // full white when unselected, theme color when selected
                      background:
                        activeDateChoice === "quit"
                          ? "var(--hero-grad-first)"
                          : "white",
                    }}
                  />
                  When did you quit?
                </Label>
                <Input
                  type="date"
                  value={formData.quit_date}
                  onChange={(e) => handleInputChange("quit_date", e.target.value)}
                  className={`glass border-white/20 text-white w-full ${activeDateChoice !== "quit" ? "opacity-60" : ""
                    }`}
                  disabled={activeDateChoice !== "quit"}
                  required={activeDateChoice === "quit"}
                />
              </div>

              <div>
                <Label className="text-white mb-2 block flex items-center gap-2">
                  <input
                    type="radio"
                    name="dateChoice"
                    value="target"
                    checked={activeDateChoice === "target"}
                    onChange={() => setActiveDateChoice("target")}
                    className="
                      appearance-none w-4 h-4 rounded-full cursor-pointer
                      border-2 border-white"
                    style={{
                      background:
                        activeDateChoice === "target"
                          ? "var(--hero-grad-first)"
                          : "white",
                    }}
                  />
                  Target Quit Date
                </Label>
                <Input
                  type="date"
                  value={formData.target_quit_date}
                  onChange={(e) => handleInputChange("target_quit_date", e.target.value)}
                  className={`glass border-white/20 text-white w-full ${activeDateChoice !== "target" ? "opacity-60" : ""
                    }`}
                  disabled={activeDateChoice !== "target"}
                  required={activeDateChoice === "target"}
                />
              </div>
            </CardContent>

          </Card>

          {/* Smoking Details */}
          <Card className="glass border-white/20 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Target className="w-5 h-5" />
                Smoking History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-white mb-2 block">
                  Cigarettes per day (before quitting)
                </Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.cigarettes_per_day_before}
                  onChange={(e) =>
                    handleInputChange("cigarettes_per_day_before", e.target.value)
                  }
                  placeholder="e.g. 20"
                  className="glass border-white/20 text-white placeholder:text-gray-400 w-full"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-white mb-2 block">Cost per pack (€)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.cost_per_pack}
                    onChange={(e) => handleInputChange("cost_per_pack", e.target.value)}
                    placeholder="e.g. 12.50"
                    className="glass border-white/20 text-white placeholder:text-gray-400 w-full"
                    required
                  />
                </div>

                <div>
                  <Label className="text-white mb-2 block">Cigarettes per pack</Label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.cigarettes_per_pack}
                    onChange={(e) => handleInputChange("cigarettes_per_pack", e.target.value)}
                    className="glass border-white/20 text-white w-full"
                    required
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quit Reasons (themed when active) */}
          <Card className="glass border-white/20 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-white">Why are you quitting?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 min-w-0">
                {quitReasons.map((reason) => {
                  const active = formData.quit_reasons.includes(reason);
                  return (
                    <Badge
                      key={reason}
                      variant={active ? "default" : "outline"}
                      className={`cursor-pointer transition-all justify-center rounded-full px-3 py-2 text-sm ${active
                        ? "text-white"
                        : "glass border-white/20 text-gray-300 hover:bg-white/10"
                        }`}
                      style={
                        active
                          ? {
                            background:
                              "var(--hero-grad, linear-gradient(90deg, #42275a 0%, #734b6d 100%))",
                            borderColor: "transparent",
                          }
                          : {}
                      }
                      onClick={() => toggleQuitReason(reason)}
                    >
                      {reason}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Notification Preferences (switches inherit theme color) */}
          <Card className="glass border-white/20 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notification Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  key: "daily_reminders",
                  title: "Daily Log Notifications",
                  desc: "Reminder to fill your log for the day",
                },
                {
                  key: "milestone_alerts",
                  title: "New Badge Notifications",
                  desc: "Celebrations for achievements",
                },
                {
                  key: "challenge_notifications",
                  title: "Challenge Notifications",
                  desc: "Reminder to generate your daily challenges",
                },
              ].map((row) => (
                <div key={row.key} className="flex items-center justify-between min-w-0">
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{row.title}</div>
                    <div className="text-gray-400 text-sm truncate">{row.desc}</div>
                  </div>
                  <Switch
                    checked={formData.notification_preferences[row.key]}
                    onCheckedChange={(value) => handleNotificationChange(row.key, value)}
                    className="data-[state=checked]:bg-[var(--hero-grad-first)] data-[state=checked]:border-[var(--hero-grad-first)]"
                  />



                </div>
              ))}
            </CardContent>
          </Card>

          {/* Theme Picker */}
          <Card className="soft-card rounded-3xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full" style={{ background: "var(--hero-grad)" }}></span>
                Application Theme
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "purple", name: "Purple Strength", grad: "linear-gradient(90deg, #42275a 0%, #734b6d 100%)", first: "#42275a" },
                  { key: "deepblue", name: "Deep Calm", grad: "linear-gradient(90deg, #1e3c72 0%, #2a5298 100%)", first: "#1e3c72" },
                  { key: "forest", name: "Forest Path", grad: "linear-gradient(90deg, #134E5E 0%, #2d793e 100%)", first: "#134E5E" },
                  { key: "sunset", name: "Sunset Drive", grad: "linear-gradient(90deg, #f12711 0%, #966c13 100%)", first: "#f12711" },
                ].map((opt) => {
                  const active = formData.dashboard_theme === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={async () => {
                        setFormData((prev) => ({ ...prev, dashboard_theme: opt.key }));
                        const uid = auth.currentUser?.uid;
                        if (uid) await updateUserProfile(uid, { theme: opt.key });
                        // instant local effect + cache
                        applyTheme(opt.key);
                      }}


                      className={`rounded-2xl p-3 border transition ${active ? "ring-2 ring-white/90 border-white/30" : "border-white/15 hover:border-white/30"
                        } bg-white/5`}
                    >
                      <div className="h-10 w-full rounded-full" style={{ background: opt.grad }} />
                      <div className="mt-2 text-xs text-white/90 font-medium text-center">{opt.name}</div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons (circular + themed) */}
          <div className="space-y-3">
            <Button
              type="submit"
              disabled={saving}
              className="w-full h-14 rounded-full flex items-center justify-center text-white border"
              style={{
                background: "var(--hero-grad)",
                borderColor: "var(--hero-grad-first)",
              }}
            >
              {saving ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                  Saving...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Save className="w-5 h-5" />
                  Save Profile
                </div>

              )}
            </Button>



            {auth.currentUser && (
              <Button
                type="button"
                variant="outline"
                onClick={handleLogout}
                className="w-full h-14 rounded-full px-6 text-white/90 hover:text-white border border-white/20 hover:border-white/30"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            )}

          </div>
        </form>
        <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Choose your avatar</DialogTitle>
            </DialogHeader>

            {/* This is the "grid" I was referring to */}
            <div className="grid grid-cols-4 gap-3">
              {avatarChoices.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={async () => {
                    if (!auth.currentUser?.uid) return;
                    const uid = auth.currentUser.uid;
                    setProfilePreview(opt.src);
                    await updateUserProfile(uid, { photoURL: opt.src });
                    setAvatarOpen(false);
                  }}
                  className="group focus:outline-none"
                  aria-label={`Select ${opt.label}`}
                >
                  <div
                    className={
                      "w-16 h-16 rounded-full overflow-hidden flex items-center justify-center " +
                      "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] " +
                      (currentAvatar === opt.src ? "ring-2 ring-white " : "")
                    }
                  >
                    <img
                      src={opt.src}
                      alt={opt.label}
                      className="block w-full h-full object-cover pointer-events-none select-none"
                    />
                  </div>
                </button>
              ))}

              {/* "None" tile */}
              <button
                type="button"
                onClick={async () => {
                  if (!auth.currentUser?.uid) return;
                  const uid = auth.currentUser.uid;
                  setProfilePreview(null);
                  await updateUserProfile(uid, { photoURL: "" }); // or deleteField()
                  setAvatarOpen(false);
                }}
                className="group focus:outline-none"
                aria-label="Remove avatar"
                title="Remove avatar"
              >
                <div
                  className={
                    "w-16 h-16 rounded-full flex items-center justify-center " +
                    "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] " +
                    (!currentAvatar ? "ring-2 ring-white " : "")
                  }
                >
                  <span className="text-[11px] uppercase tracking-wider text-gray-300">None</span>
                </div>
              </button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
