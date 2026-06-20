"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { respanClient, respanHeaders } from "./respan";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Manually fire the 9pm reflection pipeline.
 * Same code path the cron uses — generates reflection, writes it, fires
 * the dashboard's iMessage delivery (via the reflections subscription).
 */
export const triggerReflection = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runAction(internal.endOfDay.runReflection, {});
    return { ok: true } as const;
  },
});

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function callReflection(
  prompt: string,
  sessionId: string,
): Promise<{ summary: string; wins: string[]; gaps: string[] }> {
  const client = respanClient();
  const res = await client.messages.create(
    {
      model: "claude-opus-4-7",
      max_tokens: 1500,
      system:
        "You are a direct, honest reflection assistant. Not motivational. Return JSON with keys: summary (3 paragraphs as a single string), wins (string[]), gaps (string[]). No code fences.",
      messages: [{ role: "user", content: prompt }],
    },
    { headers: respanHeaders(sessionId) },
  );
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const parsed = JSON.parse(text);
  return {
    summary: String(parsed.summary ?? ""),
    wins: Array.isArray(parsed.wins) ? parsed.wins.map(String) : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String) : [],
  };
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
  handler: async (ctx) => {
    const records = await ctx.runQuery(
      internal.endOfDayDb.getTodaysTaskRecords,
      {},
    );
    const all = records.flatMap((r) => r.tasks);
    if (all.length === 0) {
      console.log("[endOfDay] no tasks today, skipping reflection");
      return;
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
      console.error("[endOfDay] Claude call failed", err);
      result = {
        summary: `Reflection unavailable (LLM error). Captured ${all.length} task(s), completed ${completed.length}.`,
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
