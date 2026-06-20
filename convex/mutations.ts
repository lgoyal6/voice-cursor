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
