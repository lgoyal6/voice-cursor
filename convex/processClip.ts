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

const SUBMIT_TASKS_TOOL = {
  name: "submit_tasks",
  description:
    "Submit the structured tasks extracted from the user's brain dump. " +
    "Always split the dump into multiple distinct tasks — never combine.",
  input_schema: {
    type: "object" as const,
    properties: {
      tasks: {
        type: "array" as const,
        description:
          "One task per distinct action. Split on commas/sentences. Strip " +
          "filler. Ignore test markers like 'smoke-1234567'.",
        items: {
          type: "object" as const,
          properties: {
            title: { type: "string", description: "Concise, imperative" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            category: {
              type: "string",
              enum: ["work", "personal", "admin", "learning"],
            },
            status: { type: "string", enum: ["todo"] },
          },
          required: ["title", "priority", "category", "status"],
        },
      },
    },
    required: ["tasks"],
  },
};

function normalizeTasks(rawTasks: any[]): StructuredTask[] {
  return rawTasks.map((t: any) => ({
    title: String(t.title ?? "").slice(0, 200),
    priority:
      t.priority === "high" || t.priority === "medium" || t.priority === "low"
        ? t.priority
        : "medium",
    category: ["work", "personal", "admin", "learning"].includes(t.category)
      ? t.category
      : "personal",
    status: "todo" as const,
  }));
}

async function callClaudeWithToolUse(
  client: Anthropic,
  transcript: string,
  sessionId: string,
): Promise<StructuredTask[]> {
  const res = await client.messages.create(
    {
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: SYSTEM,
      tools: [SUBMIT_TASKS_TOOL],
      tool_choice: { type: "tool", name: "submit_tasks" },
      messages: [{ role: "user", content: `Input: ${transcript}` }],
    },
    { headers: respanHeaders(sessionId) },
  );
  const toolUse = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    throw new Error(
      `no tool_use block; stop=${res.stop_reason} text=${text.slice(0, 200)}`,
    );
  }
  const input = toolUse.input as { tasks?: unknown };
  if (!Array.isArray(input.tasks)) throw new Error("tool_use had no tasks array");
  return normalizeTasks(input.tasks);
}

async function callClaudePlainJson(
  client: Anthropic,
  transcript: string,
  sessionId: string,
): Promise<StructuredTask[]> {
  const res = await client.messages.create(
    {
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system:
        SYSTEM +
        "\n\nReturn ONLY a JSON array starting with [ and ending with ]. No prose, no code fences.",
      messages: [{ role: "user", content: `Input: ${transcript}` }],
    },
    { headers: respanHeaders(sessionId) },
  );
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  // Strip code fences, then extract the first JSON array we can find.
  let cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no JSON array found in response: ${text.slice(0, 200)}`);
  }
  cleaned = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("parsed JSON is not an array");
  return normalizeTasks(parsed);
}

async function callClaude(
  transcript: string,
  sessionId: string,
): Promise<StructuredTask[]> {
  const client = respanClient();
  // 1. Try tool_use (cleanest, Anthropic enforces schema)
  try {
    const result = await callClaudeWithToolUse(client, transcript, sessionId);
    console.log(`[processClip] tool_use path ok, ${result.length} tasks`);
    return result;
  } catch (toolErr) {
    console.warn(
      "[processClip] tool_use failed, falling back to plain JSON prompt:",
      toolErr instanceof Error ? toolErr.message : String(toolErr),
    );
  }
  // 2. Fall back to prompt-based JSON (works even if Respan strips `tools`)
  const result = await callClaudePlainJson(client, transcript, sessionId);
  console.log(`[processClip] plain JSON path ok, ${result.length} tasks`);
  return result;
}

/** Claude split with retry + raw fallback so a transcript never vanishes. */
async function splitTranscript(
  transcript: string,
  sessionId: string,
): Promise<StructuredTask[]> {
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
  if (tasks && tasks.length > 0) return tasks;
  console.error(
    "[processClip] *** RAW FALLBACK FIRING *** transcript:",
    transcript.slice(0, 100),
    "last error:",
    lastErr instanceof Error ? lastErr.message : String(lastErr),
  );
  return [
    {
      title: transcript.slice(0, 200),
      priority: "high",
      category: "personal",
      status: "todo",
    },
  ];
}

const notionMode = () =>
  !!(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID);

/**
 * Split arbitrary text into tasks and write them to the Notion Tasks DB.
 * Used by notion.ingestPage for raw paragraphs dictated into the page body.
 */
export const structureText = internalAction({
  args: { text: v.string(), sessionId: v.optional(v.string()) },
  handler: async (ctx, { text, sessionId }): Promise<{ count: number }> => {
    const tasks = await splitTranscript(text, sessionId ?? "notion-ingest");
    await ctx.runAction(internal.notion.writeTasks, { tasks });
    return { count: tasks.length };
  },
});

export const structure = internalAction({
  args: { clipId: v.id("audio_clips"), transcript: v.string() },
  handler: async (ctx, { clipId, transcript }): Promise<{ ok: true }> => {
    const sessionId = String(clipId);
    const writtenTasks = await splitTranscript(transcript, sessionId);

    if (notionMode()) {
      // Notion is the source of truth: write rows there and let the sync cron
      // (notion.pull) ingest them into the Convex tasks table. No direct write.
      await ctx.runAction(internal.notion.writeTasks, { tasks: writtenTasks });
      await ctx.runMutation(internal.processClipMutations.markClipDone, {
        clipId,
      });
      return { ok: true };
    }

    // Fallback (Notion unset): write straight to Convex so the dashboard works.
    const taskRecordId = await ctx.runMutation(
      internal.processClipMutations.writeTasks,
      { clipId, rawText: transcript, tasks: writtenTasks },
    );
    await ctx.runMutation(internal.processClipMutations.markClipDone, {
      clipId,
    });
    await ctx.scheduler.runAfter(0, internal.executeTask.run, { taskRecordId });
    return { ok: true };
  },
});
