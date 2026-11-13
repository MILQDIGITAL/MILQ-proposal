import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { ClaudeSignReader } from "./claudeSignReader";
import { loadConfig } from "./config";
import { MockSignReader } from "./mockSignReader";
import type { SignReader } from "./signReader";

const config = loadConfig();

let reader: SignReader;
if (config.mockVision) {
  reader = new MockSignReader();
} else {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("ANTHROPIC_API_KEY is not set. Set it, or run with MOCK_VISION=1 to serve fixtures.");
    process.exit(1);
  }
  reader = new ClaudeSignReader({
    model: config.model,
    effort: config.effort,
    refusalFallback: config.refusalFallback,
    timeoutMs: config.readTimeoutMs,
    maxRetries: config.upstreamMaxRetries,
  });
}

const app = createApp({ config, reader });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: "parking-lingo server listening",
      port: info.port,
      mode: config.mockVision ? "mock" : "live",
      model: config.mockVision ? "mock" : config.model,
      effort: config.effort,
      authRequired: config.appToken !== null,
      // Never log ANTHROPIC_API_KEY or PARKING_LINGO_APP_TOKEN.
    }),
  );
});

// Slow mobile uploads + a vision call: give requests room but don't hang forever.
if ("requestTimeout" in server) {
  (server as unknown as { requestTimeout: number }).requestTimeout = config.readTimeoutMs + 15_000;
}

const shutdown = (signal: string) => {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: `received ${signal}, shutting down` }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
