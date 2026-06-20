import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // READ-ONLY mirror of teammate's table. Do not write to this from our code.
  // Declared here so Convex codegen produces types for our subscriptions.
  audio_clips: defineTable({
    status: v.string(), // "uploaded" | "processing" | "done" | "error"
    storageId: v.optional(v.id("_storage")),
    transcript: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  tasks: defineTable({
    clipId: v.optional(v.id("audio_clips")),
    // Set when this record mirrors a single Notion database row (source of truth).
    notionPageId: v.optional(v.string()),
    rawText: v.string(),
    tasks: v.array(
      v.object({
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
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_notionPageId", ["notionPageId"]),

  reflections: defineTable({
    date: v.string(), // YYYY-MM-DD
    summary: v.string(),
    wins: v.array(v.string()),
    gaps: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_date", ["date"]),
});
