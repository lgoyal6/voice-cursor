"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const priorityStyles: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

const statusStyles: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700",
  ready: "bg-blue-100 text-blue-800",
  drafted: "bg-violet-100 text-violet-800",
  scheduled: "bg-cyan-100 text-cyan-800",
  done: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-800",
};

const pipelineLabel: Record<string, { dot: string; text: string }> = {
  idle: { dot: "bg-slate-300", text: "waiting" },
  uploaded: { dot: "bg-amber-400 animate-pulse", text: "queued" },
  processing: { dot: "bg-blue-500 animate-pulse", text: "processing" },
  done: { dot: "bg-emerald-500", text: "done" },
  error: { dot: "bg-red-500", text: "error" },
};

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

export default function Page() {
  const tasks = useQuery(api.queries.todaysTasks) ?? [];
  const pipeline = useQuery(api.queries.pipelineStatus) ?? "idle";
  const reflection = useQuery(api.queries.latestReflection);
  const awaiting = useQuery(api.processClipMutations.clipAwaitingTranscript);
  const submit = useMutation(api.processClipMutations.submitTranscript);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handledClipsRef = useRef<Set<string>>(new Set());
  const deliveredReflectionRef = useRef<string | null>(null);

  // Bridge: when a clip is awaiting a transcript, poll #vc-dump and post it.
  useEffect(() => {
    if (!awaiting) return;
    const clipId = awaiting._id as unknown as string;
    if (handledClipsRef.current.has(clipId)) return;
    handledClipsRef.current.add(clipId);

    let cancelled = false;
    const started = Date.now();

    const tick = async () => {
      if (cancelled) return;
      const text = textareaRef.current?.value?.trim() ?? "";
      if (text.length > 0) {
        await submit({ clipId: awaiting._id, transcript: text });
        if (textareaRef.current) textareaRef.current.value = "";
        return;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        console.warn("[vc-dump] timeout waiting for transcript on", clipId);
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, [awaiting, submit]);

  // When a new reflection lands, deliver it via local iMessage route once.
  useEffect(() => {
    if (!reflection) return;
    const id = reflection._id as unknown as string;
    if (deliveredReflectionRef.current === id) return;
    deliveredReflectionRef.current = id;
    const to = process.env.NEXT_PUBLIC_IMESSAGE_TARGET_NUMBER;
    fetch("/api/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, text: reflection.summary }),
    }).catch((err) => console.error("[deliver]", err));
  }, [reflection]);

  const indicator = pipelineLabel[pipeline] ?? pipelineLabel.idle;

  const clear = () => {
    if (textareaRef.current) textareaRef.current.value = "";
    handledClipsRef.current.clear();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice Cursor</h1>
          <p className="text-sm text-slate-500">Today&apos;s brain dump → tasks</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${indicator.dot}`} />
          <span className="text-slate-600">{indicator.text}</span>
        </div>
      </header>

      {/* Hidden textarea — Voice Cursor types cleaned transcripts here. */}
      <textarea
        id="vc-dump"
        ref={textareaRef}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        defaultValue=""
      />

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
            Tasks
          </h2>
          <button
            onClick={clear}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Clear buffer
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No tasks captured yet today. Speak into Voice Cursor to begin.
          </div>
        ) : (
          <ul className="space-y-3">
            {tasks.flatMap((group) =>
              group.tasks.map((t, i) => (
                <li
                  key={`${group._id}-${i}`}
                  className="flex items-start justify-between rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t.category}
                      {t.executionNote ? ` · ${t.executionNote}` : ""}
                    </p>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        priorityStyles[t.priority] ?? priorityStyles.low
                      }`}
                    >
                      {t.priority}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        statusStyles[t.status] ?? statusStyles.todo
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                </li>
              )),
            )}
          </ul>
        )}
      </section>

      {reflection && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
            Last reflection · {reflection.date}
          </h2>
          <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
            {reflection.summary}
          </div>
        </section>
      )}
    </main>
  );
}
