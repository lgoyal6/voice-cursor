"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";

const taskShape = v.object({
  title: v.string(),
  priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
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

/** Returns null when Notion is not configured (the pipeline falls back to a
 *  direct Convex write so the dashboard still works). */
function creds(): { apiKey: string; databaseId: string } | null {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  return apiKey && databaseId ? { apiKey, databaseId } : null;
}

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/** Create one Notion row per task. Returns the created page ids. */
export const writeTasks = internalAction({
  args: { tasks: v.array(taskShape) },
  handler: async (_ctx, { tasks }): Promise<string[]> => {
    const c = creds();
    if (!c) {
      console.log("[notion] NOTION_API_KEY/NOTION_DATABASE_ID unset, skipping write");
      return [];
    }
    const ids: string[] = [];
    for (const t of tasks) {
      const res = await fetch(`${NOTION_BASE}/pages`, {
        method: "POST",
        headers: headers(c.apiKey),
        body: JSON.stringify({
          parent: { database_id: c.databaseId },
          properties: {
            Name: { title: [{ text: { content: t.title } }] },
            Priority: { select: { name: t.priority } },
            Category: { select: { name: t.category } },
            Status: { select: { name: t.status } },
          },
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { id: string };
        ids.push(json.id);
      } else {
        console.error("[notion] write failed:", res.status, await res.text());
      }
    }
    return ids;
  },
});

type NotionRow = {
  notionPageId: string;
  title: string;
  priority: "high" | "medium" | "low";
  category: "work" | "personal" | "admin" | "learning";
  status: "todo" | "ready" | "drafted" | "scheduled" | "done" | "error";
};

const asPriority = (s: string): NotionRow["priority"] =>
  s === "high" || s === "medium" || s === "low" ? s : "medium";
const asCategory = (s: string): NotionRow["category"] =>
  ["work", "personal", "admin", "learning"].includes(s)
    ? (s as NotionRow["category"])
    : "personal";
const asStatus = (s: string): NotionRow["status"] =>
  ["todo", "ready", "drafted", "scheduled", "done", "error"].includes(s)
    ? (s as NotionRow["status"])
    : "todo";

/**
 * Poll the Notion database (source of truth) and sync every row into the
 * Convex `tasks` table. Runs on a cron tick. No-op when Notion is unset.
 */
export const pull = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const c = creds();
    if (!c) return;

    const rows: NotionRow[] = [];
    let cursor: string | undefined = undefined;
    do {
      const res: Response = await fetch(
        `${NOTION_BASE}/databases/${c.databaseId}/query`,
        {
          method: "POST",
          headers: headers(c.apiKey),
          body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
        },
      );
      if (!res.ok) {
        console.error("[notion] pull failed:", res.status, await res.text());
        return;
      }
      const data = (await res.json()) as {
        results: any[];
        has_more: boolean;
        next_cursor: string | null;
      };
      for (const p of data.results) {
        if (p.archived || p.in_trash) continue;
        const props = p.properties ?? {};
        const title = (props.Name?.title ?? [])
          .map((t: any) => t.plain_text ?? "")
          .join("")
          .trim();
        if (!title) continue;
        rows.push({
          notionPageId: p.id,
          title,
          priority: asPriority(props.Priority?.select?.name ?? "medium"),
          category: asCategory(props.Category?.select?.name ?? "personal"),
          status: asStatus(props.Status?.select?.name ?? "todo"),
        });
      }
      cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
    } while (cursor);

    await ctx.runMutation(internal.processClipMutations.syncNotionRows, { rows });
  },
});

/**
 * Read raw brain-dump paragraphs dictated into the PhoneCursor page body
 * (Voice Cursor + BlackHole types here), split each into tasks via Claude,
 * write them as rows into the Tasks database, then delete the consumed block
 * so it isn't reprocessed. The pull() cron then ingests the rows into Convex.
 * No-op if Notion / NOTION_PAGE_ID unset.
 */
export const ingestPage = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const c = creds();
    const pageId = process.env.NOTION_PAGE_ID;
    if (!c || !pageId) return;

    const res = await fetch(
      `${NOTION_BASE}/blocks/${pageId}/children?page_size=100`,
      { headers: headers(c.apiKey) },
    );
    if (!res.ok) {
      console.error("[notion] ingestPage list failed:", res.status, await res.text());
      return;
    }
    const data = (await res.json()) as { results: any[] };

    for (const b of data.results) {
      if (b.type !== "paragraph") continue;
      const text = (b.paragraph?.rich_text ?? [])
        .map((r: any) => r.plain_text ?? "")
        .join("")
        .trim();
      if (!text) continue;

      // Split into tasks → Tasks DB rows.
      await ctx.runAction(internal.processClip.structureText, {
        text,
        sessionId: `notion-${b.id}`,
      });

      // Consume the paragraph so the next tick doesn't reprocess it.
      const del = await fetch(`${NOTION_BASE}/blocks/${b.id}`, {
        method: "DELETE",
        headers: headers(c.apiKey),
      });
      if (!del.ok) {
        console.error("[notion] block delete failed:", del.status, await del.text());
      }
    }
  },
});

/** Write a status change back to a single Notion row (two-way sync). */
export const setStatus = internalAction({
  args: { pageId: v.string(), status: v.string() },
  handler: async (_ctx, { pageId, status }): Promise<void> => {
    const c = creds();
    if (!c) return;
    const res = await fetch(`${NOTION_BASE}/pages/${pageId}`, {
      method: "PATCH",
      headers: headers(c.apiKey),
      body: JSON.stringify({
        properties: { Status: { select: { name: asStatus(status) } } },
      }),
    });
    if (!res.ok) {
      console.error("[notion] setStatus failed:", res.status, await res.text());
    }
  },
});
