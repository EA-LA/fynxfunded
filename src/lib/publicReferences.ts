type ReferenceRecord = {
  id?: unknown;
  orderId?: unknown;
  orderNumber?: unknown;
  challengeId?: unknown;
  accountId?: unknown;
  accountReference?: unknown;
  brokerAccountId?: unknown;
  login?: unknown;
};

function valueOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stableNumber(value: string, digits: number) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const modulus = 10 ** digits;
  return String(Math.abs(hash >>> 0) % modulus).padStart(digits, "0");
}

export function isInternalReference(value: unknown) {
  const reference = valueOf(value);
  return /^(cs_(test|live)_|pi_|ch_|ord_|sess_)/i.test(reference) || reference.length > 28;
}

export function publicOrderReference(order: ReferenceRecord | string) {
  if (typeof order !== "string") {
    const saved = valueOf(order.orderNumber);
    if (saved) return saved;
  }
  const raw = typeof order === "string" ? order : valueOf(order.orderId) || valueOf(order.id);
  if (raw && !isInternalReference(raw) && /^FYNX-/i.test(raw)) return raw.toUpperCase();
  return `FYNX-${stableNumber(raw || "receipt", 8)}`;
}

export function publicAccountReference(account: ReferenceRecord | string) {
  if (typeof account !== "string") {
    const candidates = [account.accountReference, account.brokerAccountId, account.login];
    const existing = candidates.map(valueOf).find((value) => value && !isInternalReference(value));
    if (existing) return existing;
  }
  const raw = typeof account === "string" ? account : valueOf(account.accountId) || valueOf(account.challengeId) || valueOf(account.id);
  if (raw && !isInternalReference(raw) && /^FX-/i.test(raw)) return raw.toUpperCase();
  return `FX-${stableNumber(raw || "account", 6)}`;
}

export function displayDate(value: unknown, withTime = false) {
  if (!value) return "Payment confirmed";
  const date = typeof value === "object" && value !== null && "toDate" in value
    ? (value as { toDate: () => Date }).toDate()
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Payment confirmed";
  return date.toLocaleString(undefined, withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { year: "numeric", month: "long", day: "numeric" });
}
