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

export default crons;
