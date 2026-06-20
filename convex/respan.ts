"use node";

import Anthropic from "@anthropic-ai/sdk";

const BASE_URL =
  process.env.RESPAN_BASE_URL ?? "https://api.respan.ai/v1";

export function respanClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({
    apiKey,
    baseURL: BASE_URL,
  });
}

export function respanHeaders(sessionId: string) {
  return {
    "X-Customer-Identifier": "hackathon-demo",
    "X-Session-Id": sessionId,
  };
}
