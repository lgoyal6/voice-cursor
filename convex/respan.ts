"use node";

import Anthropic from "@anthropic-ai/sdk";

// The Anthropic SDK appends "/v1/messages" to baseURL. We strip any trailing
// /v1 or slashes so users can pass either form (with or without /v1) safely.
function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export function respanClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  // Default to direct Anthropic. Set RESPAN_BASE_URL on Convex to route
  // through the Respan gateway once we have the correct host from their docs.
  const raw = process.env.RESPAN_BASE_URL ?? "https://api.anthropic.com";
  const baseURL = normalizeBaseUrl(raw);
  console.log(`[respan] raw="${raw}" → baseURL="${baseURL}"`);
  return new Anthropic({ apiKey, baseURL });
}

export function respanHeaders(sessionId: string) {
  return {
    "X-Customer-Identifier": "hackathon-demo",
    "X-Session-Id": sessionId,
  };
}
