// FYNX trading engine host: the program that runs on Cloud Run (or any Node 22+ server).
// Not part of the website and never deployed by this repository.
//
// Build:  npm run engine:build      → engine-host/build/ (server.mjs + package.json + README.txt)
// Run:    cd engine-host/build && npm install && npm start   (with the FYNX_* settings in the environment)
//
// All logic lives in src/engine/host-main.ts (tested). This file only connects
// Google Cloud: Firestore and Firebase Auth through firebase-admin, Node's own
// WebSocket and node:http. Credentials come from the service account the host
// runs as (Cloud Run) or GOOGLE_APPLICATION_CREDENTIALS; nothing secret is in here.
import http from "node:http";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HostStartError, nodeListen, startEngineHost } from "@/engine/host-main";
import { FOREX_PAIRS } from "@/trade-access/instruments";

if (typeof WebSocket !== "function") {
  console.error(JSON.stringify({ severity: "ERROR", message: "This Node.js has no built-in WebSocket. Use Node 22 or newer." }));
  process.exit(1);
}

initializeApp();
const auth = getAuth();

try {
  const host = await startEngineHost({
    env: process.env,
    pairs: FOREX_PAIRS,
    db: getFirestore(),
    verifyIdToken: token => auth.verifyIdToken(token),
    getUser: uid => auth.getUser(uid),
    socket: url => new WebSocket(url),
    listen: nodeListen(handler => http.createServer(handler)),
  });
  let stopping = false;
  const shutdown = signal => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ severity: "INFO", message: `Received ${signal}.` }));
    host.stop().then(() => process.exit(0), error => {
      console.error(JSON.stringify({ severity: "ERROR", message: `Stop failed: ${error?.message ?? error}` }));
      process.exit(1);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
} catch (error) {
  if (error instanceof HostStartError) {
    if (error.report) console.error(error.report); // readable copy of the list logged above
    console.error(error.message);
  } else {
    console.error(JSON.stringify({ severity: "ERROR", message: `Engine failed to start: ${error?.message ?? error}` }));
  }
  process.exit(1);
}
