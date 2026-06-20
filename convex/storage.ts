import { mutation } from "./_generated/server";
import { v } from "convex/values";

/** Returns a one-time URL the watcher POSTs the audio bytes to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/**
 * Called by the watcher / iOS Shortcut endpoint after audio bytes are uploaded.
 * Inserts an "uploaded" row; the audio agent's claimNext picks it up serially.
 */
export const submitAudioClip = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.db.insert("audio_clips", {
      status: "uploaded",
      storageId,
      createdAt: Date.now(),
    });
  },
});
