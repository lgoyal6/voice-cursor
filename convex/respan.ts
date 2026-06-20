"use node";

import Anthropic from "@anthropic-ai/sdk";

// The Anthropic SDK appends "/v1/messages" to baseURL, so the env var must
// NOT already end in /v1 (otherwise we'd request /v1/v1/messages → 404).
function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export function respanClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  // Resolve baseURL fresh each call so env changes don't require redeploy.
  const raw = process.env.RESPAN_BASE_URL ?? "https://api.respan.ai";
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
