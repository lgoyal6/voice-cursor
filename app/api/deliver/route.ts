import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function POST(req: Request) {
  const body = (await req.json()) as { to?: string; text?: string };
  const to = body.to ?? process.env.IMESSAGE_TARGET_NUMBER;
  const text = body.text ?? "";
  if (!to || !text) {
    return NextResponse.json({ ok: false, reason: "missing to or text" }, { status: 400 });
  }
  // Escape double quotes for embedding in the AppleScript string literal.
  const safeText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const safeTo = to.replace(/"/g, "");
  const script = `tell application "Messages" to send "${safeText}" to buddy "${safeTo}" of service "iMessage"`;
  try {
    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
