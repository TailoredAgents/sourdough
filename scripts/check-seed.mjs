import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const seedPath = "supabase/seed.sql";
const failures = [];

function formatList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

if (!existsSync(seedPath)) {
  failures.push(`${seedPath} is missing.`);
} else {
  const seed = readFileSync(seedPath, "utf8");
  const fixedTimestampLiterals = seed.match(/'20\d{2}-\d{2}-\d{2}T\d{2}:[^']*'/g) || [];

  if (fixedTimestampLiterals.length) {
    failures.push(
      `Seed contains fixed timestamp literals: ${fixedTimestampLiterals.join(", ")}.`,
    );
  }

  if (seed.includes("Launch Week Bake Drop")) {
    failures.push("Seed still uses the stale Launch Week Bake Drop starter name.");
  }

  if (!seed.includes("with launch_schedule as")) {
    failures.push("Seed must derive weekly menu dates from launch_schedule.");
  }

  if (!seed.includes("with launch_windows as")) {
    failures.push("Seed must derive delivery window dates from launch_windows.");
  }

  if (!seed.includes("FMDay, Mon FMDD, FMHH12:MI AM")) {
    failures.push("Seed delivery window labels must include weekday, month, day, and time.");
  }
}

if (failures.length) {
  console.error("Seed freshness check failed:");
  console.error(formatList(failures));
  process.exit(1);
}

console.log("Seed freshness check passed.");
