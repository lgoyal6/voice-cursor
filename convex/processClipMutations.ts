import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";

const taskShape = v.object({
  title: v.string(),
  priority: v.union(
    v.literal("high"),
    v.literal("medium"),
    v.literal("low"),
  ),
  category: v.union(
    v.literal("work"),
    v.literal("personal"),
    v.literal("admin"),
    v.literal("learning"),
  ),
  status: v.union(
    v.literal("todo"),
    v.literal("ready"),
    v.literal("drafted"),
    v.literal("scheduled"),
    v.literal("done"),
    v.literal("error"),
  ),
  executionNote: v.optional(v.string()),
});

export const markClipProcessing = internalMutation({
  args: { clipId: v.id("audio_clips") },
  handler: async (ctx, { clipId }) => {
    await ctx.db.patch(clipId, { status: "processing" });
  },
});

export const setClipTranscript = internalMutation({
  args: { clipId: v.id("audio_clips"), transcript: v.string() },
  handler: async (ctx, { clipId, transcript }) => {
    await ctx.db.patch(clipId, { transcript });
  },
});

export const markClipDone = internalMutation({
  args: { clipId: v.id("audio_clips") },
  handler: async (ctx, { clipId }) => {
    await ctx.db.patch(clipId, { status: "done" });
  },
});

export const writeTasks = internalMutation({
  args: {
    clipId: v.id("audio_clips"),
    rawText: v.string(),
    tasks: v.array(taskShape),
  },
  handler: async (ctx, { clipId, rawText, tasks }) => {
    return await ctx.db.insert("tasks", {
      clipId,
      rawText,
      tasks,
      createdAt: Date.now(),
    });
  },
});

export const updateTaskStatus = internalMutation({
  args: {
    taskRecordId: v.id("tasks"),
    index: v.number(),
    status: v.union(
      v.literal("todo"),
      v.literal("ready"),
      v.literal("drafted"),
      v.literal("scheduled"),
      v.literal("done"),
      v.literal("error"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { taskRecordId, index, status, note }) => {
    const rec = await ctx.db.get(taskRecordId);
    if (!rec) return;
    const next = rec.tasks.map((t, i) =>
      i === index ? { ...t, status, executionNote: note ?? t.executionNote } : t,
    );
    await ctx.db.patch(taskRecordId, { tasks: next });
  },
});

/**
 * Picks up freshly uploaded clips that the audio agent does NOT own
 * (i.e., no storageId — typed clips, Voice Cursor textarea clips).
 * Audio-bearing clips are left for the agent's atomic claim.
 */
export const claimUploadedClips = internalMutation({
  args: {},
  handler: async (ctx) => {
    const clips = await ctx.db
      .query("audio_clips")
      .withIndex("by_status", (q) => q.eq("status", "uploaded"))
      .collect();
    const claimedIds: string[] = [];
    for (const c of clips) {
      if (c.storageId) continue; // agent owns audio clips
      await ctx.db.patch(c._id, { status: "processing" });
      claimedIds.push(String(c._id));
      if (c.transcript && c.transcript.length > 0) {
        await ctx.scheduler.runAfter(0, internal.processClip.structure, {
          clipId: c._id,
          transcript: c.transcript,
        });
      }
    }
    return claimedIds;
  },
});

/** Dashboard Dictate button — fastest path, skips audio + Whisper. */
export const submitTypedClip = mutation({
  args: { transcript: v.string() },
  handler: async (ctx, { transcript }) => {
    const trimmed = transcript.trim();
    if (!trimmed) return null;
    const clipId = await ctx.db.insert("audio_clips", {
      status: "processing",
      transcript: trimmed,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.processClip.structure, {
      clipId,
      transcript: trimmed,
    });
    return clipId;
  },
});

/** Public mutation invoked by the dashboard after scraping #vc-dump. */
export const submitTranscript = mutation({
  args: { clipId: v.id("audio_clips"), transcript: v.string() },
  handler: async (ctx, { clipId, transcript }) => {
    const trimmed = transcript.trim();
    if (!trimmed) return { ok: false } as const;
    await ctx.db.patch(clipId, { transcript: trimmed });
    await ctx.scheduler.runAfter(0, internal.processClip.structure, {
      clipId,
      transcript: trimmed,
    });
    return { ok: true } as const;
  },
});

/** Public query so the dashboard can find a clip awaiting a transcript. */
export const clipAwaitingTranscript = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("audio_clips")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .order("desc")
      .take(1);
    const c = rows[0];
    if (!c) return null;
    if (c.transcript && c.transcript.length > 0) return null;
    return { _id: c._id, createdAt: c.createdAt };
  },
});

export const getTaskRecord = internalQuery({
  args: { taskRecordId: v.id("tasks") },
  handler: async (ctx, { taskRecordId }) => ctx.db.get(taskRecordId),
});
