/**
 * ChallengesHistory.jsx
 * ----------------------
 * Purpose: Read-only grid of the user’s completed challenges (historical),
 *          ordered by most recent.
 *
 * Data:
 * - Firestore query on Challenge collection:
 *   user_id == uid, completed == true, orderBy(created_date desc), limit 100.
 *
 * UI:
 * - Back to Challenges button.
 * - Card per challenge showing due_date (dd/MM), title, description, and a
 *   completed check icon.
 *
 * Dev Notes:
 * - Uses Auth to resolve uid (handles late auth via onAuthStateChanged).
 * - dayStr helper normalizes dates for display & stability.
 * - No edits; purely fetch & render. Loading state included.
 */

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { el } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { auth, db } from "@/firebase";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";



export default function ChallengesHistory() {
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);

  // helper to normalize any date to yyyy-MM-dd (local)
  const dayStr = (d) =>
    typeof d === "string" ? d.slice(0, 10) : format(new Date(d), "yyyy-MM-dd");

useEffect(() => {
  let off = () => {};
  (async () => {
    try {
      const cur = getAuth().currentUser;
      const uid = cur?.uid || await new Promise((resolve) => {
        off = onAuthStateChanged(auth, (u) => resolve(u?.uid || null));
      });
      if (!uid) throw new Error("Not signed in");

      const q = query(
        collection(db, "Challenge"),
        where("user_id", "==", uid),
        where("completed", "==", true),
        orderBy("created_date", "desc"),
        limit(100)
      );
      const snap = await getDocs(q);
      setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error loading history:", e);
    } finally {
      setLoading(false);
    }
  })();
  return () => off();
}, []);



  // ADD this instead (your query already fetched completed:true):
  const completedHistory = challenges; // all-time completed

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white/60"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* Back button */}
        <div className="mb-4">
          <button
            onClick={() => navigate("/challenges")}
            className="flex items-center gap-2 rounded-full px-4 py-2 bg-white/10 hover:bg-white/15 
                       border border-white/20 text-white text-sm backdrop-blur-md"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Challenges
          </button>

        </div>

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Challenge History</h1>
          <div
            className="mt-2 mx-auto w-40 h-[6px] rounded-full"
            style={{ background: "var(--hero-grad)" }}
          />
        </div>

        {completedHistory.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {completedHistory.map((challenge) => (
              <Card
                key={challenge.id}
                className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Badge
                      variant="outline"
                      className="text-white/80 border-white/20"
                    >
                      {format(new Date(challenge.due_date), "dd/MM", {
                        locale: el,
                      })}
                    </Badge>
                    {challenge.completed && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-200" />
                    )}
                  </div>
                  <CardTitle className="text-lg text-white">
                    {challenge.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-white/75">
                    {challenge.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md text-center py-10">
            <CardContent>
              <h3 className="text-xl font-semibold text-white mb-2">
                No history yet
              </h3>
              <p className="text-white/70">Complete some challenges first.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
