#!/usr/bin/env node
/**
 * Voice Cursor audio agent — serial queue worker.
 *
 * Drives the Voice Cursor + BlackHole + Hammerspoon pipeline:
 *
 *   loop:
 *     clip = convex.mutation(agentQueue.claimNext)   ← atomic, marks "processing"
 *     if !clip: sleep, continue
 *     audio = fetch(clip.audioUrl)
 *     afplay audio → BlackHole → Voice Cursor types into #vc-dump
 *     dashboard bridge submits transcript to Convex → structure → Notion → executeTask
 *     wait until clip status flips to "done" or "error", then claim next
 *
 * Strict serial: one clip in flight at a time. No Whisper, no API keys —
 * transcription is whatever Voice Cursor produces locally.
 *
 * Run:  npm run audio:agent
 *
 * Env:  NEXT_PUBLIC_CONVEX_URL   required
 *       VC_AUDIO_DEVICE          optional, e.g. "BlackHole 2ch"
 *       VC_TRANSCRIPT_TIMEOUT_MS optional (default 60000)
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
const TIMEOUT_MS = Number(process.env.VC_TRANSCRIPT_TIMEOUT_MS ?? 60_000);

if (!CONVEX_URL) {
  console.error("✗ NEXT_PUBLIC_CONVEX_URL not set");
  process.exit(1);
}

const convex = new ConvexHttpClient(CONVEX_URL);
const tmpRoot = await mkdtemp(join(tmpdir(), "vc-audio-"));
let running = true;

const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function playLocally(path) {
  return new Promise((resolve) => {
    const args = process.env.VC_AUDIO_DEVICE
      ? ["-d", process.env.VC_AUDIO_DEVICE, path]
      : [path];
    const child = spawn("afplay", args, { stdio: "ignore" });
    child.on("error", (err) => {
      console.error("[afplay]", err);
      resolve();
    });
    child.on("exit", resolve);
  });
}

async function waitForDone(clipId, deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const s = await convex.query(api.agentQueue.getClipStatus, { clipId });
    if (!s) return { ok: false, reason: "clip vanished" };
    if (s.status === "done") return { ok: true };
    if (s.status === "error") return { ok: false, reason: "clip marked error" };
    await sleep(750);
  }
  return { ok: false, reason: `timeout after ${deadlineMs}ms` };
}

async function processOne(clip) {
  console.log(`[${ts()}] claimed ${clip._id}`);

  const res = await fetch(clip.audioUrl);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  const path = join(tmpRoot, `${clip._id}.m4a`);
  await writeFile(path, audio);
  console.log(`[${ts()}]   downloaded ${audio.byteLength}B`);

  console.log(`[${ts()}]   playing via afplay → BlackHole → Voice Cursor`);
  await playLocally(path);

  console.log(`[${ts()}]   waiting for Voice Cursor transcript (≤${TIMEOUT_MS}ms)`);
  const result = await waitForDone(clip._id, TIMEOUT_MS);
  if (result.ok) {
    console.log(`[${ts()}]   ✓ clip ${clip._id} done`);
  } else {
    console.warn(`[${ts()}]   ✗ ${result.reason}`);
    await convex.mutation(api.agentQueue.failClip, {
      clipId: clip._id,
      reason: result.reason,
    });
  }
}

async function loop() {
  console.log(`[${ts()}] agent starting · ${CONVEX_URL}`);
  console.log(`[${ts()}] dashboard must be open on Mac for Voice Cursor bridge to work`);
  while (running) {
    let clip;
    try {
      clip = await convex.mutation(api.agentQueue.claimNext, {});
    } catch (err) {
      console.error(`[${ts()}] claim failed:`, err);
      await sleep(3000);
      continue;
    }
    if (!clip) {
      await sleep(2000);
      continue;
    }
    try {
      await processOne(clip);
    } catch (err) {
      console.error(`[${ts()}] process failed:`, err);
      try {
        await convex.mutation(api.agentQueue.failClip, {
          clipId: clip._id,
          reason: String(err).slice(0, 200),
        });
      } catch {}
    }
  }
  console.log(`[${ts()}] agent stopped`);
}

const shutdown = () => {
  console.log(`\n[${ts()}] shutting down (finishing current clip…)`);
  running = false;
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

loop();
