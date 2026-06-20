import { ConvexClient } from "convex/browser";
import { api } from "./convex/_generated/api.js";
import { exec } from "node:child_process";
import { writeFileSync } from "node:fs";

const client = new ConvexClient("https://first-panther-904.convex.cloud"); // https://first-panther-904.convex.cloud
const seen = new Set();
let initialized = false;

client.onUpdate(api.agent.recentClips, {}, async (clips) => {
  for (const clip of clips) {
    if (seen.has(clip._id)) continue;
    seen.add(clip._id);
    if (!initialized || !clip.url) continue;   // seed existing on startup, skip replaying
    const buf = Buffer.from(await (await fetch(clip.url)).arrayBuffer());
    const path = `/tmp/${clip._id}.m4a`;
    writeFileSync(path, buf);
    exec(`hs -c "dictateClip('${path}')"`, (e) => e && console.error(e));
  }
  initialized = true;
});

console.log("agent listening on audio_clips...");