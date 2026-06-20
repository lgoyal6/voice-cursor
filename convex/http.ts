import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

/**
 * Direct audio upload from iOS Shortcut (or curl).
 *
 *   POST /upload-audio
 *   Content-Type: audio/m4a  (or audio/mp4)
 *   body: raw audio bytes
 *
 * Optional query param ?key=... matched against UPLOAD_SECRET if set on
 * the deployment, otherwise the endpoint is open.
 *
 * Response: { clipId, storageId }
 */
http.route({
  path: "/upload-audio",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.UPLOAD_SECRET;
    if (secret) {
      const url = new URL(req.url);
      if (url.searchParams.get("key") !== secret) {
        return new Response("unauthorized", { status: 401 });
      }
    }
    const blob = await req.blob();
    if (blob.size === 0) {
      return new Response("empty body", { status: 400 });
    }
    const storageId = await ctx.storage.store(blob);
    const clipId = await ctx.runMutation(api.storage.submitAudioClip, {
      storageId,
    });
    return new Response(JSON.stringify({ clipId, storageId }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// CORS preflight for the upload route (in case Shortcuts sends one).
http.route({
  path: "/upload-audio",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

/**
 * Hammerspoon polls this for the user's current top task.
 * Returns 204 when there is nothing to surface so the poller can skip.
 */
http.route({
  path: "/top-task",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const records = await ctx.runQuery(api.queries.todaysTasks, {});
    const all = records.flatMap((r) =>
      r.tasks.map((t, i) => ({ recordId: String(r._id), index: i, ...t })),
    );
    const open = all.filter((t) => t.status !== "done" && t.status !== "error");
    const rank = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
    open.sort((a, b) => rank(a.priority) - rank(b.priority));
    const top = open[0];
    if (!top) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ top }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

export default http;
