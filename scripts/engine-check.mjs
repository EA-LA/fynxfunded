#!/usr/bin/env node
// Readiness check for the FYNX trading engine host (docs/ENGINE-READINESS.md).
// Usage: npm run engine:check            (settings only)
//        npm run engine:check -- --feed 20  (also connects the price feed for 20 s)
// Reads environment variables only; places no orders, writes nothing, never prints the API key.
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(tmpdir(), "fynx-engine-check-"));
const out = path.join(dir, "check.mjs");
try {
  await build({
    stdin: {
      contents: 'export { runEngineCheck } from "@/engine/preflight"; export { FOREX_PAIRS } from "@/trade-access/instruments";',
      resolveDir: root, loader: "ts",
    },
    bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error",
    alias: { "@": path.join(root, "src") },
  });
  const { runEngineCheck, FOREX_PAIRS } = await import(pathToFileURL(out).href);
  const socket = typeof WebSocket === "function" ? url => new WebSocket(url) : undefined;
  process.exitCode = await runEngineCheck({ env: process.env, argv: process.argv.slice(2), pairs: FOREX_PAIRS, socket, write: t => console.log(t) });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
