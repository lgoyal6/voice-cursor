"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { respanClient, respanHeaders } from "./respan";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Manually fire the reflection pipeline. Generates, writes, and returns
 * the summary text so the button handler can send the iMessage instantly.
 */
export const triggerReflection = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; summary?: string; reason?: string }> => {
    const result = await ctx.runAction(internal.endOfDay.runReflection, {});
    if (!result || !result.summary) {
      return { ok: false, reason: "no reflection produced (likely no tasks today)" };
    }
    return { ok: true, summary: result.summary };
  },
});

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const REFLECTION_SYSTEM =
  "You are a direct, honest reflection assistant. Not motivational, not corporate. " +
  "Read the user's day and respond with a three-paragraph reflection: " +
  "what worked, what didn't, and the single most important thing for tomorrow.";

const REFLECTION_TOOL = {
  name: "submit_reflection",
  description: "Submit the end-of-day reflection.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "Three paragraphs as a single string, separated by newlines.",
      },
      wins: { type: "array", items: { type: "string" } },
      gaps: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "wins", "gaps"],
  },
};

function normalizeReflection(raw: any): {
  summary: string;
  wins: string[];
  gaps: string[];
} {
  return {
    summary: String(raw?.summary ?? "").trim(),
    wins: Array.isArray(raw?.wins) ? raw.wins.map(String) : [],
    gaps: Array.isArray(raw?.gaps) ? raw.gaps.map(String) : [],
  };
}

async function callReflectionWithToolUse(
  client: Anthropic,
  prompt: string,
  sessionId: string,
) {
  const res = await client.messages.create(
    {
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: REFLECTION_SYSTEM,
      tools: [REFLECTION_TOOL],
      tool_choice: { type: "tool", name: "submit_reflection" },
      messages: [{ role: "user", content: prompt }],
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
      `no tool_use; stop=${res.stop_reason} text=${text.slice(0, 200)}`,
    );
  }
  return normalizeReflection(toolUse.input);
}

async function callReflectionPlainJson(
  client: Anthropic,
  prompt: string,
  sessionId: string,
) {
  const res = await client.messages.create(
    {
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system:
        REFLECTION_SYSTEM +
        "\n\nReturn ONLY a JSON object with keys: summary (string, 3 paragraphs), wins (string[]), gaps (string[]). No prose, no code fences.",
      messages: [{ role: "user", content: prompt }],
    },
    { headers: respanHeaders(sessionId) },
  );
  let text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no JSON object found: ${text.slice(0, 200)}`);
  }
  text = text.slice(start, end + 1);
  return normalizeReflection(JSON.parse(text));
}

async function callReflectionPlainText(
  client: Anthropic,
  prompt: string,
  sessionId: string,
) {
  const res = await client.messages.create(
    {
      model: "claude-opus-4-7",
      max_tokens: 1500,
      system: REFLECTION_SYSTEM + " Respond as plain prose only — no JSON, no headings, no markdown.",
      messages: [{ role: "user", content: prompt }],
    },
    { headers: respanHeaders(sessionId) },
  );
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("empty plain text response");
  return { summary: text, wins: [] as string[], gaps: [] as string[] };
}

async function callReflection(
  prompt: string,
  sessionId: string,
): Promise<{ summary: string; wins: string[]; gaps: string[] }> {
  const client = respanClient();
  try {
    const r = await callReflectionWithToolUse(client, prompt, sessionId);
    console.log(`[endOfDay] tool_use path ok, summary ${r.summary.length} chars`);
    return r;
  } catch (toolErr) {
    console.warn(
      "[endOfDay] tool_use failed, falling back to plain JSON:",
      toolErr instanceof Error ? toolErr.message : String(toolErr),
    );
  }
  try {
    const r = await callReflectionPlainJson(client, prompt, sessionId);
    console.log(`[endOfDay] plain JSON path ok, summary ${r.summary.length} chars`);
    return r;
  } catch (jsonErr) {
    console.warn(
      "[endOfDay] plain JSON failed, falling back to plain text:",
      jsonErr instanceof Error ? jsonErr.message : String(jsonErr),
    );
  }
  const r = await callReflectionPlainText(client, prompt, sessionId);
  console.log(`[endOfDay] plain text path ok, summary ${r.summary.length} chars`);
  return r;
}

async function sendPhoton(text: string): Promise<void> {
  const apiKey = process.env.PHOTON_API_KEY;
  const to = process.env.PHOTON_TARGET_NUMBER;
  if (!apiKey || !to) {
    console.warn("[endOfDay] PHOTON_* env not set, skipping send");
    return;
  }
  const res = await fetch("https://api.photon.ai/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, body: text, channel: "imessage" }),
  });
  if (!res.ok) {
    throw new Error(`Photon send failed: ${res.status} ${await res.text()}`);
  }
}

export const runReflection = internalAction({
  args: {},
  handler: async (ctx): Promise<{ summary: string } | null> => {
    const records = await ctx.runQuery(
      internal.endOfDayDb.getTodaysTaskRecords,
      {},
    );
    const all = records.flatMap((r) => r.tasks);
    if (all.length === 0) {
      console.log("[endOfDay] no tasks today, skipping reflection");
      return null;
    }
    const completed = all.filter((t) => t.status === "done");
    const lines = all
      .map(
        (t) =>
          `- [${t.priority}] ${t.title} (${t.category}, ${t.status}${
            t.executionNote ? ` — ${t.executionNote}` : ""
          })`,
      )
      .join("\n");
    const completedLines = completed.map((t) => `- ${t.title}`).join("\n") || "(none)";

    const prompt = `Here are the tasks the user captured today:\n${lines}\n\nHere is what got done:\n${completedLines}\n\nWrite a 3 paragraph reflection: what went well, what didn't, and the single most important thing for tomorrow. Be direct and honest, not motivational.`;

    const sessionId = `reflection-${todayKey()}`;
    let result;
    try {
      result = await callReflection(prompt, sessionId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[endOfDay] *** ALL THREE Claude paths failed ***", detail);
      result = {
        summary: `Reflection unavailable. ${all.length} tasks today, ${completed.length} done.\n\nLLM error: ${detail.slice(0, 300)}`,
        wins: completed.map((t) => t.title),
        gaps: all.filter((t) => t.status !== "done").map((t) => t.title),
      };
    }

    await ctx.runMutation(internal.endOfDayDb.writeReflection, {
      date: todayKey(),
      summary: result.summary,
      wins: result.wins,
      gaps: result.gaps,
    });

    try {
      await sendPhoton(result.summary);
    } catch (err) {
      console.error("[endOfDay] photon delivery failed", err);
    }
    return { summary: result.summary };
  },
});

export const claimTick = internalAction({
  args: {},
  handler: async (ctx) => {
    const claimed = await ctx.runMutation(
      internal.processClipMutations.claimUploadedClips,
      {},
    );
    if (claimed.length > 0) {
      console.log("[claimTick] claimed", claimed.length, "clip(s)");
    }
  },
});
