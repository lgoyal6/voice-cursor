import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

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
