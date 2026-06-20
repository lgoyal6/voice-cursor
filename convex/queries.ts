import { query } from "./_generated/server";
import { v } from "convex/values";

export const todaysTasks = query({
  args: {},
  handler: async (ctx) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const cutoff = startOfDay.getTime();
    return await ctx.db
      .query("tasks")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", cutoff))
      .order("desc")
      .collect();
  },
});

export const pipelineStatus = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("audio_clips")
      .order("desc")
      .take(1);
    return recent[0]?.status ?? "idle";
  },
});

export const latestReflection = query({
  args: {},
  handler: async (ctx) => {
    const r = await ctx.db.query("reflections").order("desc").take(1);
    return r[0] ?? null;
  },
});

export const taskById = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});
