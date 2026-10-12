import { describe, expect, it } from "vitest";
import { documentHash, recordLegalAcceptance, type LegalRelease } from "../src/fundedLegal";

export function legalFixture(): LegalRelease {
  return { version: "test-only-v1", status: "approved", approvedBy: "test-reviewer", approvedAt: "2026-01-01T00:00:00Z", effectiveAt: "2026-01-01T00:00:00Z",
    operator: { name: "Synthetic test operator", country: "US", contact: "qa@example.invalid" }, billing: "one_time",
    documents: (["terms", "privacy", "refund", "risk"] as const).map(kind => ({ kind, version: "test-v1", url: `https://www.fynxfunded.com/${kind}`, text: `Synthetic ${kind} fixture`, sha256: documentHash(`Synthetic ${kind} fixture`) })) };
}
export const consentFor = (release: LegalRelease) => ({ accepted: true, version: release.version, documentHashes: Object.fromEntries(release.documents.map(d => [d.kind, d.sha256])) });
describe("legal purchase evidence", () => {
  it("records exact server-owned content and explicit acceptance", () => {
    const release = legalFixture();
    const receipt = recordLegalAcceptance(release, consentFor(release), "customer");
    expect(receipt.documents).toEqual(release.documents); expect(receipt.uid).toBe("customer"); expect(receipt.billing).toBe("one_time");
  });
  it.each([undefined, { ...legalFixture(), status: "draft" }, { ...legalFixture(), approvedBy: "" }, { ...legalFixture(), effectiveAt: "2999-01-01T00:00:00Z" }])("rejects missing or unapproved publication", release => {
    expect(() => recordLegalAcceptance(release, {}, "customer")).toThrow();
  });
  it("rejects stale checkbox versions and modified documents", () => {
    const release = legalFixture(); const consent = consentFor(release);
    expect(() => recordLegalAcceptance(release, { ...consent, accepted: false }, "customer")).toThrow();
    expect(() => recordLegalAcceptance(release, { ...consent, version: "old" }, "customer")).toThrow();
    release.documents[0].text += " modified";
    expect(() => recordLegalAcceptance(release, consent, "customer")).toThrow(/hash/);
  });
  it("requires all four documents and known billing", () => {
    const release = legalFixture(); release.documents.pop();
    expect(() => recordLegalAcceptance(release, consentFor(release), "customer")).toThrow(/incomplete/);
  });
});
