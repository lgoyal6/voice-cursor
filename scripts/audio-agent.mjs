#!/usr/bin/env node
/**
 * Voice Cursor audio agent — serial queue worker.
 *
 *   loop:
 *     clip = convex.mutation(agentQueue.claimNext)   // atomic
 *     if !clip: sleep, continue
 *     audio = fetch(clip.audioUrl)
 *     play locally (optional — for Voice Cursor + BlackHole rigs)
 *     transcript = whisper(audio)
 *     convex.mutation(agentQueue.completeClip)
 *       → triggers structuring → Notion mirror → executeTask
 *     (Convex 9pm cron handles reflection + iMessage delivery)
 *
 * Strict serial: one clip in flight at a time. Restart-safe (clips stay
 * "agent_claimed" until completed or marked error).
 *
 * Run:  npm run audio:agent
 * Env:  NEXT_PUBLIC_CONVEX_URL          required
 *       OPENAI_API_KEY                  required (Whisper)
 *       VC_AUDIO_DEVICE                 optional, afplay output device
 *       VC_SKIP_LOCAL_PLAY=1            optional, skip afplay entirely
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!CONVEX_URL) {
  console.error("✗ NEXT_PUBLIC_CONVEX_URL not set");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("✗ OPENAI_API_KEY not set — Whisper required for the agent");
  process.exit(1);
}

const convex = new ConvexHttpClient(CONVEX_URL);
const tmpRoot = await mkdtemp(join(tmpdir(), "vc-audio-"));
let running = true;

const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function playLocally(path) {
  if (process.env.VC_SKIP_LOCAL_PLAY === "1") return;
  const args = process.env.VC_AUDIO_DEVICE
    ? ["-d", process.env.VC_AUDIO_DEVICE, path]
    : [path];
  const child = spawn("afplay", args, { stdio: "ignore" });
  child.on("error", (err) => console.error("[afplay]", err));
}

async function transcribeWithWhisper(audioBuffer, filename) {
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/m4a" }), filename);
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return (json.text ?? "").trim();
}

async function processOne(clip) {
  console.log(`[${ts()}] claimed ${clip._id}`);

  // 1. Download audio
  const res = await fetch(clip.audioUrl);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  const path = join(tmpRoot, `${clip._id}.m4a`);
  await writeFile(path, audio);
  console.log(`[${ts()}]   downloaded ${audio.byteLength}B`);

  // 2. Optional: play locally so Voice Cursor can hear it through BlackHole
  playLocally(path);

  // 3. Transcribe via Whisper
  const transcript = await transcribeWithWhisper(audio, `${clip._id}.m4a`);
  if (!transcript) {
    throw new Error("empty transcript");
  }
  console.log(`[${ts()}]   transcript: ${transcript.slice(0, 80)}…`);

  // 4. Hand off to Convex — structure → Notion → executeTask
  await convex.mutation(api.agentQueue.completeClip, {
    clipId: clip._id,
    transcript,
  });
  console.log(`[${ts()}]   handed off to Convex pipeline`);
}

async function loop() {
  console.log(`[${ts()}] agent starting · ${CONVEX_URL}`);
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
      } catch {
        // swallow
      }
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
