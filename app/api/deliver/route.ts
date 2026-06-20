import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const buildScript = (to: string, text: string) => {
  // Escape double quotes and backslashes for embedding in an AppleScript string.
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
  return `
tell application "Messages"
  set targetService to 1st service whose service type = iMessage
  set targetBuddy to buddy "${esc(to)}" of targetService
  send "${esc(text)}" to targetBuddy
end tell
`.trim();
};

export async function POST(req: Request) {
  let body: { to?: string; text?: string };
  try {
    body = (await req.json()) as { to?: string; text?: string };
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 });
  }
  const to = (body.to ?? process.env.IMESSAGE_TARGET_NUMBER ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!to || !text) {
    return NextResponse.json(
      { ok: false, reason: "missing to or text" },
      { status: 400 },
    );
  }
  const script = buildScript(to, text);
  try {
    const { stdout, stderr } = await execFileAsync("osascript", ["-e", script], {
      timeout: 15_000,
    });
    if (stderr && stderr.trim()) {
      console.error("[deliver] osascript stderr:", stderr);
    }
    return NextResponse.json({ ok: true, stdout: stdout.trim() });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? "").trim();
    const message = stderr || err?.message || String(err);
    console.error("[deliver] osascript failed:", message);
    return NextResponse.json(
      {
        ok: false,
        reason: "osascript failed",
        detail: message.slice(0, 500),
        hint:
          message.includes("not authorized") || message.includes("(-1743)")
            ? "Grant your terminal Automation permission for Messages: System Settings → Privacy & Security → Automation → <your terminal> → enable Messages."
            : message.includes("Invalid handle")
              ? "Messages can't reach that number via iMessage. Make sure the number is in E.164 format (e.g. +14155551234) and is iMessage-reachable."
              : "Check that Messages.app is open and signed in to iMessage on this Mac.",
      },
      { status: 500 },
    );
  }
}
