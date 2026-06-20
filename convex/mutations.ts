import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Dev-only helper so we can simulate teammate's uploads without their pipeline.
export const seedAudioClip = mutation({
  args: { transcript: v.optional(v.string()) },
  handler: async (ctx, { transcript }) => {
    return await ctx.db.insert("audio_clips", {
      status: "uploaded",
      transcript,
      createdAt: Date.now(),
    });
  },
});

export const toggleTaskDone = mutation({
  args: { taskRecordId: v.id("tasks"), index: v.number() },
  handler: async (ctx, { taskRecordId, index }) => {
    const rec = await ctx.db.get(taskRecordId);
    if (!rec) return;
    const newStatus =
      rec.tasks[index]?.status === "done" ? ("todo" as const) : ("done" as const);
    const next = rec.tasks.map((t, i) =>
      i === index ? { ...t, status: newStatus } : t,
    );
    await ctx.db.patch(taskRecordId, { tasks: next });
    // Two-way sync: push the status change back to the Notion row (source of truth).
    if (rec.notionPageId) {
      await ctx.scheduler.runAfter(0, internal.notion.setStatus, {
        pageId: rec.notionPageId,
        status: newStatus,
      });
    }
  },
});
