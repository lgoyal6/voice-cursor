import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getTodaysTaskRecords = internalQuery({
  args: {},
  handler: async (ctx) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return await ctx.db
      .query("tasks")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", startOfDay.getTime()))
      .collect();
  },
});

export const writeReflection = internalMutation({
  args: {
    date: v.string(),
    summary: v.string(),
    wins: v.array(v.string()),
    gaps: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("reflections", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
