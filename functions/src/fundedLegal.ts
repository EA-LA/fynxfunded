import { createHash } from "node:crypto";

export type LegalDocument = { kind: "terms" | "privacy" | "refund" | "risk"; version: string; url: string; text: string; sha256: string };
export type LegalRelease = { version: string; status: string; approvedBy: string; approvedAt: string; effectiveAt: string; operator: { name: string; country: string; contact: string }; billing: "one_time"; documents: LegalDocument[] };
export const documentHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Approval is an operator-owned record. A checkbox cannot approve unpublished terms. */
export function recordLegalAcceptance(release: LegalRelease | undefined, input: any, uid: string, now = new Date().toISOString(), source: "authenticated_web_checkout" | "authenticated_ios_checkout" = "authenticated_web_checkout") {
  const time = Date.parse(now);
  if (!release || release.status !== "approved" || !release.version || !release.approvedBy || !Number.isFinite(time)
    || !Number.isFinite(Date.parse(release.approvedAt)) || Date.parse(release.approvedAt) > time
    || !Number.isFinite(Date.parse(release.effectiveAt)) || Date.parse(release.effectiveAt) > time
    || !release.operator?.name || !release.operator.country || !release.operator.contact || release.billing !== "one_time") {
    throw Error("Approved, effective legal terms and operator details are required before checkout.");
  }
  const documents = release.documents;
  if (!Array.isArray(documents) || documents.length !== 4 || new Set(documents.map(d => d.kind)).size !== 4
    || documents.some(d => !["terms", "privacy", "refund", "risk"].includes(d.kind) || !d.version || !d.text || d.text.length > 100000
      || !/^https:\/\/(www\.)?fynxfunded\.com\//.test(d.url) || documentHash(d.text) !== d.sha256)) throw Error("Legal publication is incomplete or its content hash is invalid.");
  if (!uid || input?.accepted !== true || input.version !== release.version || documents.some(d => input.documentHashes?.[d.kind] !== d.sha256)) {
    throw Error("Review and explicitly accept the current terms, privacy notice, refund policy and risk disclosure.");
  }
  return { schemaVersion: 1, uid, releaseVersion: release.version, acceptedAt: now, source, billing: release.billing,
    operator: release.operator, documents: documents.map(d => ({ ...d })), approval: { by: release.approvedBy, at: release.approvedAt } };
}

/** Return only the exact approved publication; no default terms are inferred. */
export function legalCatalog(release: LegalRelease | undefined) {
  if (!release) return null;
  try {
    recordLegalAcceptance(release, { accepted: true, version: release.version, documentHashes: Object.fromEntries(release.documents.map(d => [d.kind, d.sha256])) }, "publication-validation");
    return { version: release.version, documents: release.documents, operator: release.operator, billing: release.billing };
  } catch { return null; }
}
