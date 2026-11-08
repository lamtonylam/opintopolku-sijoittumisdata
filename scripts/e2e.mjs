// Gate for the live-DOM suite: these tests hit the real opintopolku.fi, so
// they never run by accident, never in a loop, and at most once per 24h.
// Usage: npm run test:e2e            (requires E2E_LIVE=1, else skips cleanly)
//        E2E_LIVE=1 E2E_FORCE=1 npm run test:e2e   (override the throttle)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stampPath = join(tmpdir(), "sijoittumisdata-e2e-last-run");
const THROTTLE_MS = 24 * 3600 * 1000;

if (process.env.E2E_LIVE !== "1") {
  console.log(
    "e2e skipped: live Opintopolku tests need E2E_LIVE=1 (they hit the real site).",
  );
  process.exit(0);
}

if (process.env.E2E_FORCE !== "1") {
  try {
    const last = Number(readFileSync(stampPath, "utf8"));
    const agoHrs = (Date.now() - last) / 3600000;
    if (Number.isFinite(last) && Date.now() - last < THROTTLE_MS) {
      console.log(
        `e2e skipped: last live run was ${agoHrs.toFixed(1)}h ago (< 24h). ` +
          `Use E2E_FORCE=1 to override.`,
      );
      process.exit(0);
    }
  } catch {
    // no stamp yet — first run proceeds
  }
}
writeFileSync(stampPath, String(Date.now()));

const result = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
