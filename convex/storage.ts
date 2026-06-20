import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/** Returns a one-time URL the watcher POSTs the audio bytes to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/**
 * Called by the watcher after it has uploaded audio bytes to Convex Storage.
 * Inserts an audio_clips row in "processing" and kicks off Whisper transcription.
 */
export const submitAudioClip = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const clipId = await ctx.db.insert("audio_clips", {
      status: "processing",
      storageId,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.transcribeAudio.transcribe, {
      clipId,
      storageId,
    });
    return clipId;
  },
});
