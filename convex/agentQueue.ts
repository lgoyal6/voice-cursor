import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Atomically claims the oldest "uploaded" audio clip for the agent.
 * Marks status "processing" — this is what the dashboard's bridge looks
 * for to start polling #vc-dump for the Voice Cursor transcript.
 */
export const claimNext = mutation({
  args: {},
  handler: async (ctx) => {
    const clip = await ctx.db
      .query("audio_clips")
      .withIndex("by_status", (q) => q.eq("status", "uploaded"))
      .order("asc")
      .first();
    if (!clip || !clip.storageId) return null;
    await ctx.db.patch(clip._id, { status: "processing" });
    const audioUrl = await ctx.storage.getUrl(clip.storageId);
    return {
      _id: clip._id,
      storageId: clip.storageId,
      audioUrl,
      createdAt: clip.createdAt,
    };
  },
});

/** Lets the agent poll completion of a claim. */
export const getClipStatus = query({
  args: { clipId: v.id("audio_clips") },
  handler: async (ctx, { clipId }) => {
    const c = await ctx.db.get(clipId);
    if (!c) return null;
    return { status: c.status, hasTranscript: !!c.transcript };
  },
});

export const failClip = mutation({
  args: { clipId: v.id("audio_clips"), reason: v.optional(v.string()) },
  handler: async (ctx, { clipId, reason }) => {
    await ctx.db.patch(clipId, { status: "error" });
    if (reason) console.error("[agentQueue] failClip", clipId, reason);
  },
});
