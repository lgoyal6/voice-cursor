import { mutation } from "./_generated/server";
import { v } from "convex/values";

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
    const next = rec.tasks.map((t, i) =>
      i === index
        ? { ...t, status: t.status === "done" ? ("todo" as const) : ("done" as const) }
        : t,
    );
    await ctx.db.patch(taskRecordId, { tasks: next });
  },
});
