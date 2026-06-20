#!/usr/bin/env node
/**
 * Voice Cursor audio agent.
 *
 * Subscribes to Convex (real-time WebSocket, not polling) and reacts to new
 * audio clips:
 *   1. Downloads the audio blob via the signed URL returned from Convex.
 *   2. Writes it to a temp file.
 *   3. Plays it via `afplay`. With BlackHole as macOS output, Voice Cursor
 *      hears it as mic input, transcribes it, and types into the focused
 *      #vc-dump textarea in the dashboard.
 *
 * Convex's own Whisper pipeline still runs in parallel — this agent is the
 * "Voice Cursor path" for live transcription, not a replacement.
 *
 * Dedupe is in-memory; restart re-plays anything from the last 30 minutes,
 * which is fine for a demo. Add a Convex field if you need durable dedupe.
 *
 * Run:  npm run audio:agent
 * Env:  NEXT_PUBLIC_CONVEX_URL (auto-set by `npx convex dev`)
 *       VC_AUDIO_DEVICE  optional, passed to `afplay -d` (e.g. "BlackHole 2ch")
 *       VC_DRY_RUN=1     optional, skip afplay (just log new clips)
 */

import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("✗ Set NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) before running.");
  process.exit(1);
}

const tmpRoot = await mkdtemp(join(tmpdir(), "vc-audio-"));
const processed = new Set();

function ts() {
  return new Date().toISOString().slice(11, 19);
}

async function downloadAndPlay(clip) {
  const res = await fetch(clip.audioUrl);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = join(tmpRoot, `${clip._id}.m4a`);
  await writeFile(path, buf);
  if (process.env.VC_DRY_RUN === "1") {
    console.log(`[${ts()}] DRY · would play ${path} (${buf.byteLength}B)`);
    return;
  }
  const args = process.env.VC_AUDIO_DEVICE
    ? ["-d", process.env.VC_AUDIO_DEVICE, path]
    : [path];
  console.log(`[${ts()}] play ${clip._id} (${buf.byteLength}B)`);
  const child = spawn("afplay", args, { stdio: "ignore" });
  child.on("error", (err) => console.error("[afplay]", err));
}

const client = new ConvexClient(CONVEX_URL);
console.log(`[${ts()}] subscribing to recent audio clips at ${CONVEX_URL}`);

const unsubscribe = client.onUpdate(
  api.queries.recentAudioClipsWithUrls,
  {},
  async (clips) => {
    for (const c of clips) {
      if (processed.has(c._id)) continue;
      processed.add(c._id);
      console.log(`[${ts()}] new clip ${c._id} status=${c.status}`);
      try {
        await downloadAndPlay(c);
      } catch (err) {
        console.error(`[${ts()}] failed:`, err);
      }
    }
  },
  (err) => console.error(`[${ts()}] subscription error:`, err),
);

const shutdown = async () => {
  console.log(`\n[${ts()}] shutting down`);
  if (typeof unsubscribe === "function") unsubscribe();
  await client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
