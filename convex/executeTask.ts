"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const EMAIL_HINTS = ["email", "reply", "send", "draft", "write to", "follow up", "respond"];
const CAL_HINTS = ["schedule", "meeting", "calendar", "book", "block", "invite", "call with"];

function priorityRank(p: "high" | "medium" | "low"): number {
  return p === "high" ? 0 : p === "medium" ? 1 : 2;
}

function detectIntent(title: string): "email" | "calendar" | "none" {
  const t = title.toLowerCase();
  if (EMAIL_HINTS.some((h) => t.includes(h))) return "email";
  if (CAL_HINTS.some((h) => t.includes(h))) return "calendar";
  return "none";
}

async function googleAccessToken(): Promise<string | null> {
  return process.env.GOOGLE_ACCESS_TOKEN ?? null;
}

async function draftEmail(token: string, subject: string): Promise<string> {
  // Gmail "create draft" using a minimal RFC 5322 message.
  const raw = Buffer.from(
    `To: \r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nDraft from Voice Cursor.\r\n`,
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw } }),
    },
  );
  if (!res.ok) throw new Error(`Gmail draft failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: string };
  return json.id ?? "unknown";
}

async function createCalendarEvent(
  token: string,
  summary: string,
): Promise<string> {
  // Default to a 30-min block starting in one hour.
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    },
  );
  if (!res.ok) throw new Error(`Calendar create failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: string; htmlLink?: string };
  return json.htmlLink ?? json.id ?? "unknown";
}

export const run = internalAction({
  args: { taskRecordId: v.id("tasks") },
  handler: async (ctx, { taskRecordId }) => {
    const rec = await ctx.runQuery(
      internal.processClipMutations.getTaskRecord,
      { taskRecordId },
    );
    if (!rec || rec.tasks.length === 0) return;

    // Pick top by priority, original order as tiebreaker.
    let topIndex = 0;
    for (let i = 1; i < rec.tasks.length; i++) {
      if (priorityRank(rec.tasks[i].priority) < priorityRank(rec.tasks[topIndex].priority)) {
        topIndex = i;
      }
    }
    const top = rec.tasks[topIndex];
    const intent = detectIntent(top.title);
    const token = await googleAccessToken();

    try {
      if (top.category === "work" && intent === "email") {
        if (!token) {
          await ctx.runMutation(internal.processClipMutations.updateTaskStatus, {
            taskRecordId,
            index: topIndex,
            status: "ready",
            note: "would draft email — no GOOGLE_ACCESS_TOKEN set",
          });
          return;
        }
        const draftId = await draftEmail(token, top.title);
        await ctx.runMutation(internal.processClipMutations.updateTaskStatus, {
          taskRecordId,
          index: topIndex,
          status: "drafted",
          note: `Gmail draft ${draftId}`,
        });
      } else if (top.category === "admin" && intent === "calendar") {
        if (!token) {
          await ctx.runMutation(internal.processClipMutations.updateTaskStatus, {
            taskRecordId,
            index: topIndex,
            status: "ready",
            note: "would create calendar event — no GOOGLE_ACCESS_TOKEN set",
          });
          return;
        }
        const link = await createCalendarEvent(token, top.title);
        await ctx.runMutation(internal.processClipMutations.updateTaskStatus, {
          taskRecordId,
          index: topIndex,
          status: "scheduled",
          note: `Calendar event ${link}`,
        });
      } else {
        await ctx.runMutation(internal.processClipMutations.updateTaskStatus, {
          taskRecordId,
          index: topIndex,
          status: "ready",
        });
      }
    } catch (err) {
      console.error("[executeTask]", err);
      await ctx.runMutation(internal.processClipMutations.updateTaskStatus, {
        taskRecordId,
        index: topIndex,
        status: "error",
        note: String(err).slice(0, 200),
      });
    }
  },
});
