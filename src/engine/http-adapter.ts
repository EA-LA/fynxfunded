import type { EngineServer } from "./server";
import { EngineError } from "./types";

/**
 * Puts the engine on a real HTTP server: node:http, Express, Cloud Run or a
 * Firebase `onRequest` function. The website never imports this file.
 *
 *   const engine = createEngineServer({ ... });
 *   const handler = createHttpHandler(engine, { allowedOrigins: ["https://www.fynxfunded.com"] });
 *   http.createServer(handler).listen(8080); engine.start();
 *
 * What it adds on top of `engine.handle`:
 *  - Browser access (CORS): the terminal on www.fynxfunded.com calls the
 *    engine on another address, so the browser first sends an OPTIONS
 *    "preflight". Only the listed origins get an answer the browser accepts;
 *    any other website is refused (403 `origin_not_allowed`). Requests with no
 *    Origin header (server to server, curl) still need a valid sign-in token.
 *  - Request bodies: JSON only (415 otherwise), at most `maxBodyBytes`
 *    (16 KB; 413 `too_large`), malformed JSON is 400 `bad_request`. Bodies
 *    already read by Express (`req.body`) or Firebase (`req.rawBody`) are used.
 *  - `basePath` for hosts that serve the engine under a prefix, e.g. "/engine".
 *  - An unauthenticated health address (`/healthz`) for the host's uptime
 *    checks: `{ ok, priceFeed, execution }`, nothing about any account.
 *  - Safe response headers (JSON, no caching, nosniff) and one log line per
 *    request (method, path, status, time, error code; never the token).
 */

/** The parts of Node's IncomingMessage the adapter reads (Express/Firebase requests fit too). */
export interface NodeLikeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Already-parsed body (Express json middleware). */
  body?: unknown;
  /** Raw body bytes (Firebase onRequest). */
  rawBody?: Uint8Array;
  [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array | string>;
}

/** The parts of Node's ServerResponse the adapter writes. */
export interface NodeLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface RequestLog {
  method: string;
  path: string;
  status: number;
  ms: number;
  code?: string;
}

export interface HttpAdapterOptions {
  /** Exact website origins allowed to call the engine from a browser, e.g. ["https://www.fynxfunded.com"]. */
  allowedOrigins: string[];
  /** Largest accepted request body in bytes (default 16 KB; an order is under 300 bytes). */
  maxBodyBytes?: number;
  /** Prefix the engine is served under, e.g. "/engine" (default: none). */
  basePath?: string;
  /** Unauthenticated health address (default "/healthz"); null turns it off. */
  healthPath?: string | null;
  log?: (entry: RequestLog) => void;
  clock?: () => number;
}

export const ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
export const ALLOWED_HEADERS = ["Authorization", "Content-Type", "Idempotency-Key", "Accept"] as const;

const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$|^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

/** Checks the origin list: exact https origins (http only for localhost), no wildcard, no path. */
export function checkAllowedOrigins(origins: string[]): string[] {
  if (!Array.isArray(origins) || origins.length === 0) throw new EngineError("bad_settings", "List at least one website origin allowed to call the engine, e.g. https://www.fynxfunded.com.");
  const bad = origins.filter(o => typeof o !== "string" || !ORIGIN.test(o));
  if (bad.length) throw new EngineError("bad_settings", `Not a valid website origin (use https://host, no path, no trailing slash, no *): ${bad.join(", ")}.`);
  return [...new Set(origins)];
}

function checkBasePath(p: string | undefined): string {
  if (p === undefined || p === "" || p === "/") return "";
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(p)) throw new EngineError("bad_settings", `basePath must look like /engine (got ${p}).`);
  return p;
}

const headerValue = (h: NodeLikeRequest["headers"], name: string): string | undefined => {
  const key = Object.keys(h).find(k => k.toLowerCase() === name);
  const v = key === undefined ? undefined : h[key];
  return Array.isArray(v) ? v.join(", ") : v;
};

class BodyError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Byte arrays from any realm (Node Buffer, Uint8Array from another context). */
const isBytes = (v: unknown): v is Uint8Array => ArrayBuffer.isView(v) && (v as Uint8Array).BYTES_PER_ELEMENT === 1;
const toBytes = (v: Uint8Array): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

async function readBody(req: NodeLikeRequest, limit: number): Promise<unknown> {
  // Express (or similar) already parsed it.
  if (req.body !== undefined && !isBytes(req.body) && typeof req.body !== "string") return req.body;
  let bytes: Uint8Array | null = null;
  if (isBytes(req.rawBody)) bytes = toBytes(req.rawBody);
  else if (isBytes(req.body)) bytes = toBytes(req.body);
  else if (typeof req.body === "string") bytes = new TextEncoder().encode(req.body);
  else if (req[Symbol.asyncIterator]) {
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
      const part = typeof chunk === "string" ? new TextEncoder().encode(chunk) : toBytes(chunk);
      size += part.byteLength;
      if (size > limit) throw new BodyError(413, "too_large", "The request is too large.");
      parts.push(part);
    }
    bytes = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  }
  if (!bytes || bytes.byteLength === 0) return undefined;
  if (bytes.byteLength > limit) throw new BodyError(413, "too_large", "The request is too large.");
  const type = (headerValue(req.headers, "content-type") ?? "").toLowerCase();
  if (!/^application\/json\s*(?:;|$)/.test(type)) throw new BodyError(415, "unsupported_media_type", "Send the request as JSON (Content-Type: application/json).");
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return undefined;
  try { return JSON.parse(text); } catch { throw new BodyError(400, "bad_request", "The request is not valid JSON."); }
}

/** Builds a (req, res) handler for node:http, Express, Cloud Run or Firebase onRequest. */
export function createHttpHandler(engine: Pick<EngineServer, "handle" | "status">, options: HttpAdapterOptions) {
  const origins = new Set(checkAllowedOrigins(options.allowedOrigins));
  const basePath = checkBasePath(options.basePath);
  const limit = options.maxBodyBytes ?? 16 * 1024;
  if (!Number.isInteger(limit) || limit < 256 || limit > 1024 * 1024) throw new EngineError("bad_settings", "maxBodyBytes must be a whole number between 256 and 1048576.");
  const healthPath = options.healthPath === undefined ? "/healthz" : options.healthPath;
  if (healthPath !== null && !/^\/[A-Za-z0-9._~/-]*$/.test(healthPath)) throw new EngineError("bad_settings", "healthPath must start with /.");
  const clock = options.clock ?? Date.now;

  return async function handler(req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> {
    const started = clock();
    const method = (req.method ?? "GET").toUpperCase();
    const url = req.url ?? "/";
    const [rawPath, query = ""] = url.split("?", 2);
    let path = rawPath;
    let code: string | undefined;

    const send = (status: number, body?: unknown, extra?: Record<string, string>) => {
      res.statusCode = status;
      for (const [name, value] of Object.entries(extra ?? {})) if (/^[A-Za-z-]{1,40}$/.test(name)) res.setHeader(name, value);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (body === undefined) res.end();
      else { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); }
      options.log?.({ method, path: rawPath, status, ms: clock() - started, ...(code ? { code } : {}) });
    };
    const error = (status: number, c: string, message: string) => { code = c; send(status, { error: { code: c, message } }); };

    try {
      // Browser access: only the listed websites; everyone else is refused before anything runs.
      res.setHeader("Vary", "Origin");
      const origin = headerValue(req.headers, "origin");
      if (origin !== undefined) {
        if (!origins.has(origin)) return error(403, "origin_not_allowed", "This website may not use the FYNX trading engine.");
        res.setHeader("Access-Control-Allow-Origin", origin);
      }

      if (basePath) {
        if (path !== basePath && !path.startsWith(basePath + "/")) return error(404, "not_found", "Unknown address.");
        path = path.slice(basePath.length) || "/";
      }

      if (method === "OPTIONS") {
        const wanted = (headerValue(req.headers, "access-control-request-method") ?? "").toUpperCase();
        if (origin !== undefined && wanted && !(ALLOWED_METHODS as readonly string[]).includes(wanted)) return error(405, "method_not_allowed", `Use ${ALLOWED_METHODS.join(", ")}.`);
        res.setHeader("Allow", ALLOWED_METHODS.join(", "));
        if (origin !== undefined) {
          res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
          res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS.join(", "));
          res.setHeader("Access-Control-Max-Age", "600");
        }
        return send(204);
      }

      if (healthPath !== null && path === healthPath) {
        if (method !== "GET") return error(405, "method_not_allowed", "Use GET.");
        const s = engine.status();
        return send(200, { ok: true, priceFeed: s.priceFeed, execution: s.execution });
      }

      if (!(ALLOWED_METHODS as readonly string[]).includes(method)) return error(405, "method_not_allowed", `Use ${ALLOWED_METHODS.join(", ")}.`);

      const body = method === "POST" || method === "PATCH" ? await readBody(req, limit) : undefined;
      const headers: Record<string, string | undefined> = {};
      for (const key of Object.keys(req.headers)) headers[key.toLowerCase()] = headerValue(req.headers, key.toLowerCase());
      const response = await engine.handle({ method, path: query ? `${path}?${query}` : path, headers, body });
      const err = (response.body as { error?: { code?: unknown } } | null)?.error;
      if (err && typeof err.code === "string") code = err.code;
      return send(response.status, response.body, response.headers);
    } catch (e) {
      if (e instanceof BodyError) return error(e.status, e.code, e.message);
      return error(500, "server_error", "The trading server had a problem. Refresh to see whether the request went through.");
    }
  };
}
