// src/entities/Challenge.js
// Provides basic Firestore helpers for working with Challenge documents.
// Each challenge belongs to a user (user_id) and may include title, description,
// category, difficulty, points, due_date, and completed state.

import { db } from "@/firebase";
import { collection, addDoc, doc, updateDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";

const COL = "Challenge";

export const Challenge = {
  // Create a new Challenge document.
  // Adds a timestamp and ensures the "completed" flag is boolean.
  async create(payload) {
    if (!payload?.user_id) throw new Error("Challenge.create missing user_id");
    return addDoc(collection(db, COL), {
      ...payload,
      completed: !!payload.completed,
      created_date: new Date().toISOString(),
    });
  },

  // Update an existing Challenge by id.
  async update(id, data) {
    return updateDoc(doc(db, COL, id), data);
  },

  // Fetch challenges matching optional filters (user_id, due_date, completed).
  // Supports simple ordering ("-created_date" for descending) and a result limit.
  async filter(filters = {}, sort = "-created_date", lim = 50) {
    const parts = [collection(db, COL)];
    if (filters.user_id) parts.push(where("user_id", "==", filters.user_id));
    if (typeof filters.completed === "boolean") parts.push(where("completed", "==", !!filters.completed));
    if (filters.due_date) parts.push(where("due_date", "==", filters.due_date));

    // basic ordering
    const order = sort?.startsWith("-") ? sort.slice(1) : sort;
    const dir = sort?.startsWith("-") ? "desc" : "asc";
    if (order) parts.push(orderBy(order, dir));
    if (lim) parts.push(limit(lim));

    const snap = await getDocs(query(...parts));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
};
