"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const transcribe = internalAction({
  args: { clipId: v.id("audio_clips"), storageId: v.id("_storage") },
  handler: async (ctx, { clipId, storageId }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[transcribe] OPENAI_API_KEY not set");
      await ctx.runMutation(internal.processClipMutations.markClipDone, {
        clipId,
      });
      return;
    }

    const audio = await ctx.storage.get(storageId);
    if (!audio) throw new Error(`audio not found for storageId ${storageId}`);

    const form = new FormData();
    form.append("file", audio, "memo.m4a");
    form.append("model", "whisper-1");

    const res = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      },
    );
    if (!res.ok) {
      throw new Error(
        `Whisper failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as { text: string };
    const transcript = (json.text ?? "").trim();
    if (!transcript) {
      console.warn("[transcribe] empty transcript");
      await ctx.runMutation(internal.processClipMutations.markClipDone, {
        clipId,
      });
      return;
    }

    await ctx.runMutation(internal.processClipMutations.setClipTranscript, {
      clipId,
      transcript,
    });
    await ctx.scheduler.runAfter(0, internal.processClip.structure, {
      clipId,
      transcript,
    });
  },
});
