/**
 * Manually run a real photo through Claude vision + the rules engine.
 *
 *   ANTHROPIC_API_KEY=... npm run try-image -w server -- ./sign.jpg [--tz Australia/Sydney] [--side left|right] [--permit 12]
 *
 * Costs real money (one vision call, two if the first output fails validation).
 * Skips (exit 0) when ANTHROPIC_API_KEY is not set.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { evaluate } from "@parking-lingo/core";
import { ClaudeSignReader } from "../src/claudeSignReader";
import { loadConfig } from "../src/config";
import { checkImage } from "../src/image";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const path = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
if (!path) {
  console.error("Usage: tsx scripts/try-image.ts <image.jpg|png|webp> [--tz Australia/Sydney] [--side left|right] [--permit 12]");
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY is not set; skipping the real API call.");
  process.exit(0);
}

const config = loadConfig();
const ext = extname(path).toLowerCase();
const mediaType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
const image = checkImage({ base64: readFileSync(path).toString("base64"), mediaType }, config.maxImageBytes);
const timeZone = arg("tz") ?? "Australia/Sydney";
const side = (arg("side") as "left" | "right" | undefined) ?? "unknown";
const permit = arg("permit");
const now = new Date();

const reader = new ClaudeSignReader({
  model: config.model,
  effort: config.effort,
  refusalFallback: config.refusalFallback,
  timeoutMs: config.readTimeoutMs,
  maxRetries: config.upstreamMaxRetries,
});

const started = performance.now();
const result = await reader.read({ image: { base64: image.base64, mediaType: image.mediaType }, now, timeZone });
const ms = Math.round(performance.now() - started);
const verdict = evaluate(result.reading, { now, timeZone, side, permits: permit ? [permit] : [] });

console.log(JSON.stringify({ model: result.model, attempts: result.attempts, ms, usage: result.usage }, null, 2));
console.log("\n--- reading ---\n" + JSON.stringify(result.reading, null, 2));
console.log(`\n--- verdict ---\n${verdict.status.toUpperCase()}: ${verdict.headline}\n${verdict.summary}`);
if (verdict.leaveBy) console.log(`leave by: ${verdict.leaveBy}`);
for (const w of verdict.warnings) console.log(`warning: ${w}`);
