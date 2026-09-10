import { describe, expect, it } from "vitest";
import { generateReceipt } from "@/services/payments";
import type { Order } from "@/services/types";

const order: Order = {
  orderId: "order_FYNX_1001",
  userId: "user_1",
  challengeId: "challenge_1",
  amount: 79,
  currency: "USD",
  paymentMethod: "card",
  status: "paid",
  createdAt: "2026-09-09T12:00:00.000Z",
  paidAt: "2026-09-09T12:01:00.000Z",
  challenge: "$10K 2-Phase Challenge",
  accountSize: 10_000,
  phase: "2-phase",
  style: "normal",
};

describe("payment receipts", () => {
  it("includes the immutable order and payment facts", () => {
    const receipt = generateReceipt(order);
    expect(receipt).toContain("order_FYNX_1001");
    expect(receipt).toContain("$10K 2-Phase Challenge");
    expect(receipt).toContain("Account Size: $10,000");
    expect(receipt).toContain("Method:       Credit/Debit Card");
    expect(receipt).toContain("Amount:       $79");
    expect(receipt).toContain("Status:       PAID");
  });

  it.each([
    ["paypal", "PayPal"],
    ["apple", "Apple Pay"],
    ["crypto", "Cryptocurrency"],
  ] as const)("formats %s payments", (paymentMethod, expected) => {
    expect(generateReceipt({ ...order, paymentMethod })).toContain(`Method:       ${expected}`);
  });

  it("contains the required simulated-trading disclosure", () => {
    expect(generateReceipt(order)).toContain("This is a simulated trading evaluation.");
  });
});
