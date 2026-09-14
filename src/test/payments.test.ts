import { describe, expect, it } from "vitest";
import { createReceiptPdf } from "@/services/payments";
import { displayDate, isInternalReference, publicAccountReference, publicOrderReference } from "@/lib/publicReferences";

const order = {
  orderId: "cs_test_a16R2x1s97X7oTwfFFc0D8o4wF4aGkZKkz7Y4WUYKIcRYG4bYnn6TZBl51",
  amount: 199,
  currency: "USD",
  paymentMethod: "card" as const,
  status: "paid",
  createdAt: "2026-09-09T12:00:00.000Z",
  challenge: "$25,000 2-phase challenge",
  accountSize: 25_000,
  phase: "2-phase",
};

describe("customer-facing references", () => {
  it("never exposes a Stripe Checkout session ID", () => {
    const receipt = publicOrderReference(order);
    expect(receipt).toMatch(/^FYNX-\d{8}$/);
    expect(receipt).not.toContain("cs_test");
    expect(isInternalReference(order.orderId)).toBe(true);
  });

  it("creates stable, short account references", () => {
    const first = publicAccountReference({ challengeId: order.orderId });
    expect(first).toMatch(/^FX-\d{6}$/);
    expect(publicAccountReference({ challengeId: order.orderId })).toBe(first);
  });

  it("does not display Invalid Date", () => {
    expect(displayDate("not-a-date")).toBe("Payment confirmed");
  });
});

describe("PDF receipt", () => {
  it("creates one real A4 PDF page", async () => {
    const pdf = await createReceiptPdf(order);
    expect(pdf.getNumberOfPages()).toBe(1);
    const bytes = pdf.output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
  });
});
