import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export function codeHash(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
export function decodeSecret(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/\s/g, "").replace(/=+$/, "");
  if (!/^[A-Z2-7]{16,128}$/.test(normalized)) throw new Error("Invalid authenticator configuration");
  let bits = "";
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeSecret(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
export function matchingCounter(secret: string, code: string, now: number, lastCounter: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  for (const counter of [current, current - 1, current + 1]) {
    if (counter > lastCounter && timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code))) return counter;
  }
  return null;
}
export interface FactorState {
  enabled: boolean;
  version: string;
  secret?: string;
  recoveryHashes?: string[];
  lastCounter?: number;
  failures?: number;
  windowStarted?: number;
  blockedUntil?: number;
}
export function verifyFactor(state: FactorState, code: string, now: number): { state: FactorState; ok: boolean; locked: boolean } {
  if ((state.blockedUntil ?? 0) > now) return { state, ok: false, locked: true };
  const normalized = code.trim().toUpperCase();
  let counter: number | null = null;
  if (state.secret && /^\d{6}$/.test(normalized)) counter = matchingCounter(state.secret, normalized, now, state.lastCounter ?? -1);
  const hash = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,3}$/.test(normalized) ? codeHash(normalized) : "";
  const recovery = (state.recoveryHashes ?? []).findIndex(item => /^[a-f0-9]{64}$/.test(item) && hash.length == 64 && timingSafeEqual(Buffer.from(item), Buffer.from(hash)));
  if (counter !== null || recovery >= 0) {
    return { state: { ...state, lastCounter: counter ?? state.lastCounter ?? -1, recoveryHashes: (state.recoveryHashes ?? []).filter((_, i) => i !== recovery), failures: 0, windowStarted: now, blockedUntil: 0 }, ok: true, locked: false };
  }
  const failures = now - (state.windowStarted ?? 0) >= 900_000 ? 1 : (state.failures ?? 0) + 1;
  return { state: { ...state, failures, windowStarted: failures === 1 ? now : state.windowStarted, blockedUntil: failures >= 5 ? now + 900_000 : 0 }, ok: false, locked: failures >= 5 };
}
export interface SessionProof { uid: string; version: string; expiresAt: number; }
export function sessionValid(proof: SessionProof | undefined, uid: string, version: string, now: number): boolean {
  return !!proof && proof.uid === uid && proof.version === version && proof.expiresAt > now;
}
