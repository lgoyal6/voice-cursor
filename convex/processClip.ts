"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { respanClient, respanHeaders } from "./respan";
import type Anthropic from "@anthropic-ai/sdk";

type StructuredTask = {
  title: string;
  priority: "high" | "medium" | "low";
  category: "work" | "personal" | "admin" | "learning";
  status: "todo";
};

const SYSTEM = `You are a task extraction assistant. Take the user's voice brain dump and split it into SEPARATE tasks — one task per distinct action.

Rules:
- Every comma-separated item, every sentence, and every distinct action becomes its OWN task. Do not combine multiple actions into one task.
- Strip filler ("um", "uh", "remind me to", "I need to", "also"). Keep the title short and imperative (e.g. "Email mom about Thanksgiving").
- Ignore any leading test markers like "smoke 1234567:" — they are not tasks.

Return a JSON array of tasks. Each task has:
- title: string, concise, imperative
- priority: "high" | "medium" | "low"
- category: "work" | "personal" | "admin" | "learning"
- status: "todo"

Order by priority (high first). Remove duplicates. Respond with ONLY the JSON array — no prose, no code fences, no markdown.`;

async function callClaude(
  transcript: string,
  sessionId: string,
): Promise<StructuredTask[]> {
  const client = respanClient();
  const res = await client.messages.create(
    {
      model: "claude-opus-4-7",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: `Input: ${transcript}` }],
    },
    { headers: respanHeaders(sessionId) },
  );
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  // Tolerate accidental code fences.
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Claude did not return an array");
  return parsed.map((t: any) => ({
    title: String(t.title ?? "").slice(0, 200),
    priority:
      t.priority === "high" || t.priority === "medium" || t.priority === "low"
        ? t.priority
        : "medium",
    category:
      ["work", "personal", "admin", "learning"].includes(t.category)
        ? t.category
        : "personal",
    status: "todo" as const,
  }));
}

export const structure = internalAction({
  args: { clipId: v.id("audio_clips"), transcript: v.string() },
  handler: async (ctx, { clipId, transcript }): Promise<{ taskRecordId: string }> => {
    const sessionId = String(clipId);
    let tasks: StructuredTask[] | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        tasks = await callClaude(transcript, sessionId);
        break;
      } catch (err) {
        lastErr = err;
        console.error("[processClip] attempt", attempt, err);
      }
    }
    let taskRecordId;
    let writtenTasks: StructuredTask[];
    if (tasks && tasks.length > 0) {
      writtenTasks = tasks;
      taskRecordId = await ctx.runMutation(
        internal.processClipMutations.writeTasks,
        { clipId, rawText: transcript, tasks },
      );
    } else {
      console.error("[processClip] fallback to raw, last error:", lastErr);
      writtenTasks = [
        {
          title: transcript.slice(0, 200),
          priority: "high",
          category: "personal",
          status: "todo",
        },
      ];
      taskRecordId = await ctx.runMutation(
        internal.processClipMutations.writeTasks,
        { clipId, rawText: transcript, tasks: writtenTasks },
      );
    }
    // Mirror to Notion (fire-and-forget; silently skips if env unset).
    await ctx.scheduler.runAfter(0, internal.notion.writeTasks, {
      tasks: writtenTasks,
    });
    await ctx.runMutation(internal.processClipMutations.markClipDone, {
      clipId,
    });
    // Hand off to executor for the top task.
    await ctx.scheduler.runAfter(0, internal.executeTask.run, {
      taskRecordId,
    });
    return { taskRecordId };
  },
});
