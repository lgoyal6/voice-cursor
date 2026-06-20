#!/usr/bin/env node
/**
 * Watches the Voice Memos sync directory for new recordings (synced from
 * Apple Watch via iCloud) and pushes them into the Voice Cursor pipeline.
 *
 *   1. On new .m4a file:
 *      - Generate a Convex upload URL.
 *      - POST the audio bytes to it → storageId.
 *      - Insert an audio_clips row with that storageId.
 *      - Convex transcribes via Whisper → structures via Claude → Notion + tasks.
 *   2. Also plays the file via afplay so a local Voice Cursor + BlackHole rig
 *      can transcribe it in parallel (set VC_AUDIO_DEVICE to target an output).
 *
 * Run with:  npm run voicememo:watch
 *
 * Requires:  npm i -D chokidar
 * Env:       NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL)
 *            VC_AUDIO_DEVICE  optional
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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

async function uploadToConvex(path) {
  const uploadUrl = await convex.mutation(api.storage.generateUploadUrl, {});
  const bytes = await readFile(path);
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "audio/mp4" },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`Convex upload failed: ${res.status} ${await res.text()}`);
  }
  const { storageId } = await res.json();
  const clipId = await convex.mutation(api.storage.submitAudioClip, {
    storageId,
  });
  return { clipId, storageId };
}

async function handleFile(path) {
  if (seen.has(path)) return;
  if (!path.toLowerCase().endsWith(".m4a")) return;
  try {
    if (statSync(path).mtimeMs < startedAt - 1000) return;
  } catch {
    return;
  }
  seen.add(path);
  console.log("[voicememo]", new Date().toISOString(), "new recording:", path);
  try {
    const { clipId, storageId } = await uploadToConvex(path);
    console.log(
      "[voicememo] uploaded to Convex:",
      "clip=" + clipId,
      "storage=" + storageId,
    );
  } catch (err) {
    console.error("[voicememo] Convex upload failed:", err);
  }
  // Also play locally so a Voice Cursor + BlackHole rig can pick it up.
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
