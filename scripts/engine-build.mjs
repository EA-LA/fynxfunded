#!/usr/bin/env node
// Builds the FYNX trading engine host into engine-host/build/ (docs/ENGINE-READINESS.md, "Run it").
// Usage: npm run engine:build [-- --out <folder>]
// Output: server.mjs (one file, the engine + host), package.json (start script, Node 22+,
// firebase-admin at the version the Firebase functions use) and README.txt.
// Builds only: deploys nothing, reads no secrets, writes nothing outside the output folder.
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--out");
const out = path.resolve(root, i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "engine-host/build");
if (!out.startsWith(root + path.sep) && !out.startsWith(path.resolve(process.env.TMPDIR ?? "/tmp") + path.sep)) {
  console.error(`Refusing to write outside the repository: ${out}`);
  process.exit(1);
}

const adminVersion = JSON.parse(readFileSync(path.join(root, "functions/package.json"), "utf8")).dependencies?.["firebase-admin"];
if (!adminVersion) {
  console.error("functions/package.json has no firebase-admin dependency to copy the version from.");
  process.exit(1);
}

// Replace only the files this script writes (a node_modules from "npm install" in the folder is kept).
mkdirSync(out, { recursive: true });
for (const f of ["server.mjs", "package.json", "README.txt"]) rmSync(path.join(out, f), { force: true });
await build({
  entryPoints: [path.join(root, "engine-host/server.mjs")],
  outfile: path.join(out, "server.mjs"),
  bundle: true, platform: "node", target: "node22", format: "esm", logLevel: "error",
  alias: { "@": path.join(root, "src") },
  external: ["firebase-admin", "firebase-admin/*"],
  banner: { js: "// Built by `npm run engine:build` from the fynxfunded repository. Do not edit; rebuild instead." },
  legalComments: "none",
});

writeFileSync(path.join(out, "package.json"), JSON.stringify({
  name: "fynx-trading-engine",
  private: true,
  type: "module",
  description: "FYNX trading engine host (built from the fynxfunded repository).",
  engines: { node: ">=22" },
  scripts: { start: "node server.mjs" },
  dependencies: { "firebase-admin": adminVersion },
}, null, 2) + "\n");

writeFileSync(path.join(out, "README.txt"), `FYNX trading engine host
========================

This folder is the whole engine server. It was built by "npm run engine:build"
from the fynxfunded repository; rebuild it after pulling new code.

1. Fill in the settings (environment variables) listed in
   docs/ENGINE-READINESS.md: FYNX_ENGINE_* (trading settings) and
   FYNX_FEED_* (price provider). Put FYNX_FEED_API_KEY in the host's secret
   settings, never in a file.
2. Check them from the repository: npm run engine:check -- --feed 20
3. Run it:
   - Cloud Run (recommended): upload this folder as the service source, with
     the variables above, minimum instances 1 (the timer must keep running) and
     the service account that has Firestore and Firebase Auth access.
   - Any Node 22+ server: npm install, then npm start.
4. The server refuses to start while a required setting is missing and prints
   what is missing. GET /healthz shows whether prices are arriving.

Trading stays OFF until FYNX_ENGINE_ALLOW_TRADING=true is set here AND an
account has tradingEnabled: true on its account document.
Email notices stay OFF until FYNX_ENGINE_EMAIL_NOTICES=true (install an email
sender on the Firestore "mail" collection first).
On every start, trades closed in the last 7 days that are missing from the
dashboard are written again (FYNX_ENGINE_LEDGER_CATCHUP_DAYS, 0 = off).
`);

console.log(`Engine host built in ${path.relative(root, out) || out}/ (server.mjs, package.json, README.txt). Nothing was deployed.`);
