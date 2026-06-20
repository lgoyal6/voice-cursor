"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const priorityStyles: Record<string, string> = {
  high: "bg-red-100 text-red-800 ring-red-200",
  medium: "bg-amber-100 text-amber-800 ring-amber-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

const statusStyles: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700",
  ready: "bg-blue-100 text-blue-800",
  drafted: "bg-violet-100 text-violet-800",
  scheduled: "bg-cyan-100 text-cyan-800",
  done: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-800",
};

const categoryEmoji: Record<string, string> = {
  work: "💼",
  personal: "🌿",
  admin: "📎",
  learning: "📚",
};

const pipelineLabel: Record<string, { dot: string; text: string }> = {
  idle: { dot: "bg-slate-300", text: "waiting" },
  uploaded: { dot: "bg-amber-400 animate-pulse", text: "queued" },
  processing: { dot: "bg-blue-500 animate-pulse", text: "structuring" },
  done: { dot: "bg-emerald-500", text: "ready" },
  error: { dot: "bg-red-500", text: "error" },
};

const PRIORITY_ORDER: Array<"high" | "medium" | "low"> = ["high", "medium", "low"];

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

const EXAMPLE_DUMP =
  "email mom about thanksgiving, schedule dentist next week, learn convex actions, order printer ink";

export default function Page() {
  const tasks = useQuery(api.queries.todaysTasks) ?? [];
  const pipeline = useQuery(api.queries.pipelineStatus) ?? "idle";
  const stats = useQuery(api.queries.todaysStats);
  const inFlight = useQuery(api.queries.inFlightClip);
  const reflection = useQuery(api.queries.latestReflection);
  const awaiting = useQuery(api.processClipMutations.clipAwaitingTranscript);

  const submit = useMutation(api.processClipMutations.submitTranscript);
  const submitTyped = useMutation(api.processClipMutations.submitTypedClip);
  const seed = useMutation(api.mutations.seedAudioClip);
  const toggle = useMutation(api.mutations.toggleTaskDone);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handledClipsRef = useRef<Set<string>>(new Set());
  const deliveredReflectionRef = useRef<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());
  const [dictating, setDictating] = useState(false);

  // Live clock for the header.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Hammerspoon ⌘⇧V deep link: ?dictate=1 → focus textarea for Voice Cursor.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("dictate") === "1") startDictation();
  }, []);

  // Local quick-add path: dump current textarea contents into Convex as a
  // typed clip (skips audio storage + Whisper entirely).
  const submitTypedClip = async () => {
    const text = textareaRef.current?.value?.trim() ?? "";
    if (!text) return;
    await submitTyped({ transcript: text });
    if (textareaRef.current) textareaRef.current.value = "";
    setDictating(false);
  };

  const startDictation = () => {
    setDictating(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

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

  // Animate new task arrivals.
  useEffect(() => {
    setArrivals((prev) => {
      const next = new Set(prev);
      for (const r of tasks) {
        const key = String(r._id);
        if (!prev.has(key)) {
          next.add(key);
          setTimeout(() => {
            setArrivals((cur) => {
              const updated = new Set(cur);
              updated.delete(key);
              return updated;
            });
          }, 800);
        }
      }
      return next;
    });
  }, [tasks]);

  // Deliver reflection via local iMessage route once per new reflection.
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

  const grouped = useMemo(() => {
    const buckets: Record<
      "high" | "medium" | "low",
      Array<{ recordId: string; index: number; t: (typeof tasks)[number]["tasks"][number] }>
    > = { high: [], medium: [], low: [] };
    for (const r of tasks) {
      r.tasks.forEach((t, i) =>
        buckets[t.priority].push({ recordId: String(r._id), index: i, t }),
      );
    }
    return buckets;
  }, [tasks]);

  const dateLine = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const hour = now.getHours();
  const greeting =
    hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Afternoon" : "Evening";

  const seedDemo = async () => {
    if (textareaRef.current) textareaRef.current.value = EXAMPLE_DUMP;
    await seed({});
  };

  const clear = () => {
    if (textareaRef.current) textareaRef.current.value = "";
    handledClipsRef.current.clear();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
            {dateLine}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {greeting}, Laksh.
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Speak. We&apos;ll structure the rest.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs">
          <span className={`h-2 w-2 rounded-full ${indicator.dot}`} />
          <span className="text-slate-700">{indicator.text}</span>
        </div>
      </header>

      {/* Dictation textarea — visible when Voice Cursor is active, hidden otherwise. */}
      {dictating ? (
        <section className="mt-6 rounded-xl border border-violet-300 bg-violet-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-violet-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-600" />
              </span>
              Voice Cursor — dictate now
            </div>
            <div className="flex gap-2">
              <button
                onClick={submitTypedClip}
                className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700"
              >
                Submit
              </button>
              <button
                onClick={() => setDictating(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
          <textarea
            id="vc-dump"
            ref={textareaRef}
            autoFocus
            placeholder="Voice Cursor will type here…"
            className="min-h-[80px] w-full resize-none rounded-md border border-violet-200 bg-white p-3 text-sm focus:border-violet-500 focus:outline-none"
            defaultValue=""
          />
        </section>
      ) : (
        <textarea
          id="vc-dump"
          ref={textareaRef}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          defaultValue=""
        />
      )}

      {/* Stats hero */}
      <section className="mt-6 grid grid-cols-3 gap-3">
        <StatCard label="Captured" value={stats?.captured ?? 0} />
        <StatCard label="Done" value={stats?.done ?? 0} tone="emerald" />
        <StatCard label="In flight" value={stats?.inFlight ?? 0} tone="violet" />
      </section>

      {/* Live "thinking" panel */}
      {inFlight && (
        <section className="mt-6 overflow-hidden rounded-xl border border-blue-200 bg-blue-50/60 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-blue-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            Structuring
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">
            {inFlight.transcript
              ? `“${inFlight.transcript}”`
              : "Waiting for transcript from Voice Cursor…"}
          </p>
        </section>
      )}

      {/* Tasks */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-slate-500">
            Today&apos;s tasks
          </h2>
          <div className="flex gap-2">
            <button
              onClick={startDictation}
              className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700"
            >
              Dictate
            </button>
            <button
              onClick={seedDemo}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Seed demo
            </button>
            <button
              onClick={clear}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Clear buffer
            </button>
          </div>
        </div>

        {stats?.captured === 0 || tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {PRIORITY_ORDER.map((p) => {
              const rows = grouped[p];
              if (rows.length === 0) return null;
              return (
                <div key={p}>
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
                    <span>{p}</span>
                    <span className="h-px flex-1 bg-slate-200" />
                    <span>{rows.length}</span>
                  </div>
                  <ul className="space-y-2">
                    {rows.map(({ recordId, index, t }) => {
                      const isNew = arrivals.has(recordId);
                      return (
                        <li
                          key={`${recordId}-${index}`}
                          className={`group flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-all ${
                            isNew ? "animate-[fadeIn_0.4s_ease-out]" : ""
                          }`}
                        >
                          <button
                            onClick={() =>
                              toggle({
                                taskRecordId: recordId as unknown as never,
                                index,
                              })
                            }
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                              t.status === "done"
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-slate-300 hover:border-slate-500"
                            }`}
                            aria-label="toggle done"
                          >
                            {t.status === "done" ? "✓" : ""}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-sm font-medium ${
                                t.status === "done"
                                  ? "text-slate-400 line-through"
                                  : "text-slate-900"
                              }`}
                            >
                              {t.title}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              <span>{categoryEmoji[t.category] ?? "•"}</span>{" "}
                              {t.category}
                              {t.executionNote ? ` · ${t.executionNote}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${
                                priorityStyles[t.priority] ?? priorityStyles.low
                              }`}
                            >
                              {t.priority}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                                statusStyles[t.status] ?? statusStyles.todo
                              }`}
                            >
                              {t.status}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {reflection && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
            Last reflection · {reflection.date}
          </h2>
          <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-700">
            {reflection.summary}
          </div>
        </section>
      )}

      <footer className="mt-12 text-center text-xs text-slate-400">
        Voice Cursor · Convex + Claude via Respan
      </footer>
    </main>
  );
}

function StatCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "violet";
}) {
  const toneStyles =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "violet"
        ? "text-violet-700"
        : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneStyles}`}>
        {value}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-sm text-slate-600">No tasks yet today.</p>
      <p className="mt-2 text-xs text-slate-400">
        Try saying something like:
      </p>
      <p className="mt-2 italic text-sm text-slate-500">
        &ldquo;{EXAMPLE_DUMP}&rdquo;
      </p>
    </div>
  );
}
