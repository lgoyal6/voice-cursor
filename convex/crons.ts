import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// End-of-day reflection at 9pm America/Los_Angeles (hackathon is in PT).
// Convex cron times are UTC; 9pm PT ≈ 04:00 UTC the next day.
crons.cron(
  "end-of-day reflection",
  "0 4 * * *",
  internal.endOfDay.runReflection,
);

// Poll for new "uploaded" clips so we can claim them → "processing".
// Dashboard then scrapes #vc-dump and posts the transcript.
crons.interval(
  "claim uploaded clips",
  { seconds: 5 },
  internal.endOfDay.claimTick,
);

// Ingest raw brain-dump paragraphs dictated into the Notion page body →
// Claude split → Tasks DB rows (then deletes the consumed paragraph).
crons.interval("ingest notion page", { seconds: 10 }, internal.notion.ingestPage);

// Pull the Notion task database (source of truth) into Convex every 8s so the
// dashboard reflects whatever is in Notion. No-op if Notion env is unset.
crons.interval("sync notion tasks", { seconds: 8 }, internal.notion.pull);

export default crons;
