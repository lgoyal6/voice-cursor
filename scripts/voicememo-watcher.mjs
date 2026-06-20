#!/usr/bin/env node
/**
 * Watches the Voice Memos sync directory for new recordings (synced from
 * Apple Watch via iCloud) and pushes them into the Voice Cursor pipeline.
 *
 *   1. On new .m4a file:
 *      - Insert an `audio_clips` row in Convex (status: "uploaded").
 *      - Play the file via `afplay`. If macOS default output is set to the
 *        BlackHole loopback device, Voice Cursor will hear it as mic input,
 *        transcribe, and type into the focused #vc-dump textarea.
 *   2. The existing dashboard bridge + Convex cron pick it up from there.
 *
 * Run with:  node scripts/voicememo-watcher.mjs
 *
 * Requires:  npm i -D chokidar
 * Env:       NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL)
 *            VC_AUDIO_DEVICE  optional, passed to `afplay -d`
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import chokidar from "chokidar";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const RECORDINGS_DIR = join(
  homedir(),
  "Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings",
);

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("Set NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) before running.");
  process.exit(1);
}
if (!existsSync(RECORDINGS_DIR)) {
  console.error(
    `Voice Memos sync dir not found: ${RECORDINGS_DIR}\n` +
      "Enable iCloud → Voice Memos on the Mac and record one memo first.",
  );
  process.exit(1);
}

const convex = new ConvexHttpClient(CONVEX_URL);
const startedAt = Date.now();
const seen = new Set();

function playFile(path) {
  const args = process.env.VC_AUDIO_DEVICE
    ? ["-d", process.env.VC_AUDIO_DEVICE, path]
    : [path];
  const child = spawn("afplay", args, { stdio: "ignore" });
  child.on("error", (err) => console.error("[afplay]", err));
}

async function handleFile(path) {
  if (seen.has(path)) return;
  if (!path.toLowerCase().endsWith(".m4a")) return;
  // Ignore files that existed before the watcher started.
  try {
    if (statSync(path).mtimeMs < startedAt - 1000) return;
  } catch {
    return;
  }
  seen.add(path);

  console.log("[voicememo]", new Date().toISOString(), "new recording:", path);
  try {
    const clipId = await convex.mutation(api.mutations.seedAudioClip, {});
    console.log("[voicememo] inserted audio_clips row:", clipId);
  } catch (err) {
    console.error("[voicememo] Convex insert failed:", err);
  }
  playFile(path);
}

console.log("[voicememo] watching", RECORDINGS_DIR);
chokidar
  .watch(RECORDINGS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 },
  })
  .on("add", handleFile)
  .on("change", handleFile);
