// seed_challenges.cjs — Firestore seeder for challenges_catalog.json
// Purpose: upsert (and optionally prune) the challenges catalog in Firestore.
// Usage:
//   1) Place serviceAccountKey.json next to this file (DO NOT COMMIT IT).
//   2) node seed_challenges.cjs            # upsert only
//   3) PRUNE=soft node seed_challenges.cjs # mark missing docs inactive
//   4) PRUNE=delete node seed_challenges.cjs # delete missing docs
// Notes: uses batched writes; respects createdAt on existing docs.

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const BATCH_SIZE = 400;
const PRUNE = (process.env.PRUNE || "").toLowerCase(); 

function makeIdFromTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

async function commitBatch(batch, pendingCount) {
  if (pendingCount === 0) return 0;
  await batch.commit();
  return 0;
}

async function main() {
  const file = path.resolve("./challenges_catalog.json");
  if (!fs.existsSync(file)) {
    console.error("Missing challenges_catalog.json");
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(input) || input.length === 0) {
    console.error("challenges_catalog.json must be a non-empty array");
    process.exit(1);
  }

  // Build desired set
  const desired = new Map(); // id -> item
  for (const item of input) {
    const title = String(item.title || "").trim();
    if (!title) continue;
    const id = makeIdFromTitle(title);
    desired.set(id, {
      title,
      description: String(item.description || "").trim(),
      category: item.category || "habits",
      difficulty: item.difficulty || "easy",
      points: Number(item.points || 10),
      active: item.active === false ? false : true,
      rand: typeof item.rand === "number" ? item.rand : Math.random(),
      tags: Array.isArray(item.tags) ? item.tags : [],
      // NEW FIELDS
      source_org: item.source_org || null,
      source: item.source || null,
      coachPrompt: item.coachPrompt || null,
    });
  }

  // Read existing docs to support pruning and preserve createdAt
  const colRef = db.collection("challenges_catalog");
  const snap = await colRef.get();
  const existingIds = new Set();
  const existingMap = new Map(); // id -> existing data
  snap.forEach((d) => {
    existingIds.add(d.id);
    existingMap.set(d.id, d.data() || {});
  });

  let batch = db.batch();
  let writesInBatch = 0;
  let upserts = 0;
  let created = 0;
  let updated = 0;

  // Upsert all desired docs
  for (const [id, data] of desired.entries()) {
    const ref = colRef.doc(id);
    const existed = existingIds.has(id);

    // Preserve createdAt if doc exists
    const payload = {
      ...data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!existed) {
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    batch.set(ref, payload, { merge: true });
    upserts++;
    if (existed) updated++;
    else created++;

    writesInBatch++;
    if (writesInBatch >= BATCH_SIZE) {
      writesInBatch = await commitBatch(batch, writesInBatch);
      batch = db.batch();
    }
  }

  // Optional prune: deactivate or delete anything not in desired
  let pruned = 0;
  if (PRUNE === "soft" || PRUNE === "delete") {
    for (const id of existingIds) {
      if (!desired.has(id)) {
        const ref = colRef.doc(id);
        if (PRUNE === "delete") {
          batch.delete(ref);
        } else {
          batch.set(ref, { active: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        pruned++;
        writesInBatch++;
        if (writesInBatch >= BATCH_SIZE) {
          writesInBatch = await commitBatch(batch, writesInBatch);
          batch = db.batch();
        }
      }
    }
  }

  // Commit any remaining writes
  if (writesInBatch > 0) {
    await batch.commit();
  }

  console.log(`✅ Seed complete:
  Upserts: ${upserts} (created: ${created}, updated: ${updated})
  ${PRUNE ? `Pruned (${PRUNE}): ${pruned}` : "Pruned: 0"}
  `);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
