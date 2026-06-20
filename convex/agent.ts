import { query } from "./_generated/server";

export const recentClips = query({
  args: {},
  handler: async (ctx) => {
    const clips = await ctx.db.query("audio_clips").order("desc").take(5);
    return Promise.all(
      clips.map(async (c) => ({
        _id: c._id,
        url: c.storageId ? await ctx.storage.getUrl(c.storageId) : null,
      })),
    );
  },
});