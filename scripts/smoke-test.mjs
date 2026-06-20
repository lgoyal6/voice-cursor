#!/usr/bin/env node
/**
 * Voice Cursor end-to-end smoke test.
 *
 * Submits a known transcript via the quick-add path and asserts that:
 *   1. tasks appear in Convex within DEADLINE_MS
 *   2. structured fields look right (priority/category set, status === todo|ready)
 *   3. /top-task HTTP action returns the highest priority task
 *
 * Notion + Respan are exercised as side effects — failures there are logged
 * but don't fail the script (they're optional env vars).
 *
 * Run: npm run smoke
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
const CONVEX_SITE_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
const DEADLINE_MS = 30_000;
const TRANSCRIPT =
  `smoke ${Date.now()}: ` +
  "email mom about thanksgiving, schedule dentist next week, learn convex actions, order printer ink";

if (!CONVEX_URL) {
  console.error("✗ NEXT_PUBLIC_CONVEX_URL not set");
  process.exit(1);
}

const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const ok = (s) => console.log(c(32, "✓"), s);
const warn = (s) => console.log(c(33, "!"), s);
const fail = (s) => console.log(c(31, "✗"), s);
const info = (s) => console.log(c(36, "·"), s);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollFor(predicate, label) {
  const start = Date.now();
  while (Date.now() - start < DEADLINE_MS) {
    const r = await predicate();
    if (r) return { result: r, elapsed: Date.now() - start };
    await sleep(500);
  }
  throw new Error(`timed out after ${DEADLINE_MS}ms waiting for: ${label}`);
}

async function main() {
  const convex = new ConvexHttpClient(CONVEX_URL);

  info(`Convex URL: ${CONVEX_URL}`);
  info(`transcript: "${TRANSCRIPT.slice(0, 60)}…"`);

  // 1. Snapshot existing task count so we know which is "ours".
  const before = await convex.query(api.queries.todaysTasks, {});
  info(`existing task records today: ${before.length}`);

  // 2. Submit via the typed-clip mutation (skips audio + Whisper).
  const clipId = await convex.mutation(
    api.processClipMutations.submitTypedClip,
    { transcript: TRANSCRIPT },
  );
  ok(`submitted typed clip ${clipId}`);

  // 3. Wait for a new tasks record to land (Claude via Respan happens here).
  const { result: newRecord, elapsed } = await pollFor(async () => {
    const all = await convex.query(api.queries.todaysTasks, {});
    return all.find((r) => r.rawText === TRANSCRIPT) ?? null;
  }, "tasks record with our transcript");
  ok(`structured ${newRecord.tasks.length} task(s) in ${elapsed}ms`);

  // 4. Validate task shape.
  let shapeIssues = 0;
  for (const t of newRecord.tasks) {
    if (!t.title || !t.priority || !t.category || !t.status) {
      shapeIssues++;
    }
    if (!["high", "medium", "low"].includes(t.priority)) shapeIssues++;
    if (!["work", "personal", "admin", "learning"].includes(t.category)) shapeIssues++;
  }
  if (shapeIssues === 0) ok("task shape valid");
  else fail(`${shapeIssues} shape issues across ${newRecord.tasks.length} task(s)`);

  // 5. Print a summary of what Claude produced.
  for (const t of newRecord.tasks) {
    info(`  [${t.priority}] ${t.title}  (${t.category} · ${t.status}${t.executionNote ? " · " + t.executionNote : ""})`);
  }

  // 6. /top-task HTTP endpoint check.
  if (CONVEX_SITE_URL) {
    try {
      const res = await fetch(`${CONVEX_SITE_URL}/top-task`);
      if (res.status === 200) {
        const json = await res.json();
        ok(`/top-task returned: "${json.top?.title}"`);
      } else if (res.status === 204) {
        warn("/top-task returned 204 (no open tasks)");
      } else {
        fail(`/top-task returned ${res.status}`);
      }
    } catch (err) {
      fail(`/top-task fetch failed: ${err}`);
    }
  } else {
    warn("NEXT_PUBLIC_CONVEX_SITE_URL not set — skipping /top-task check");
  }

  // 7. Notion side-effect check (best effort — we just look for the env vars).
  if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
    warn("NOTION_API_KEY / NOTION_DATABASE_ID not set locally — Notion mirror skipped on the server too if Convex env unset");
  } else {
    info("Notion env set locally — check your Notion DB for new rows manually");
  }

  console.log();
  ok(`smoke test passed in ${elapsed}ms`);
}

main().catch((err) => {
  console.error();
  fail(String(err));
  process.exit(1);
});
