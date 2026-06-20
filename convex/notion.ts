"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const taskShape = v.object({
  title: v.string(),
  priority: v.union(
    v.literal("high"),
    v.literal("medium"),
    v.literal("low"),
  ),
  category: v.union(
    v.literal("work"),
    v.literal("personal"),
    v.literal("admin"),
    v.literal("learning"),
  ),
  status: v.union(
    v.literal("todo"),
    v.literal("ready"),
    v.literal("drafted"),
    v.literal("scheduled"),
    v.literal("done"),
    v.literal("error"),
  ),
  executionNote: v.optional(v.string()),
});

/**
 * Mirrors structured tasks to a Notion database.
 * Expects the target database to have Name (title), Priority/Category/Status (select).
 * Silently skips if NOTION_API_KEY or NOTION_DATABASE_ID is unset.
 */
export const writeTasks = internalAction({
  args: { tasks: v.array(taskShape) },
  handler: async (_ctx, { tasks }) => {
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!apiKey || !databaseId) {
      console.log("[notion] NOTION_API_KEY or NOTION_DATABASE_ID unset, skipping");
      return;
    }
    for (const t of tasks) {
      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: {
            Name: { title: [{ text: { content: t.title } }] },
            Priority: { select: { name: t.priority } },
            Category: { select: { name: t.category } },
            Status: { select: { name: t.status } },
          },
        }),
      });
      if (!res.ok) {
        console.error("[notion] write failed:", res.status, await res.text());
      }
    }
  },
});
