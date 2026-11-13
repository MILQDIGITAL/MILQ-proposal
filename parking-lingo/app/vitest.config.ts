import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests cover pure logic only (no React Native imports), so plain Node is enough.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
