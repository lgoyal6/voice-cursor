import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Atomically claims the oldest unprocessed audio clip for the agent.
 * Returns { _id, storageId, audioUrl, createdAt } or null.
 *
 * The clip is marked status="agent_claimed" so subsequent claims skip it
 * and the cron leaves it alone.
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
    await ctx.db.patch(clip._id, { status: "agent_claimed" });
    const audioUrl = await ctx.storage.getUrl(clip.storageId);
    return {
      _id: clip._id,
      storageId: clip.storageId,
      audioUrl,
      createdAt: clip.createdAt,
    };
  },
});

/**
 * Agent calls this once it has a transcript. Sets the transcript on the
 * clip, marks "processing", and schedules the full structuring pipeline
 * (Claude via Respan → tasks → Notion mirror → executeTask).
 */
export const completeClip = mutation({
  args: { clipId: v.id("audio_clips"), transcript: v.string() },
  handler: async (ctx, { clipId, transcript }) => {
    const trimmed = transcript.trim();
    if (!trimmed) {
      await ctx.db.patch(clipId, { status: "error" });
      return { ok: false } as const;
    }
    await ctx.db.patch(clipId, {
      status: "processing",
      transcript: trimmed,
    });
    await ctx.scheduler.runAfter(0, internal.processClip.structure, {
      clipId,
      transcript: trimmed,
    });
    return { ok: true } as const;
  },
});

export const failClip = mutation({
  args: { clipId: v.id("audio_clips"), reason: v.optional(v.string()) },
  handler: async (ctx, { clipId, reason }) => {
    await ctx.db.patch(clipId, { status: "error" });
    if (reason) console.error("[agentQueue] failClip", clipId, reason);
  },
});
