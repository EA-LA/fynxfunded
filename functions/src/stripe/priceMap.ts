export type Plan = { accountSize: number; phase: "1" | "2" | "3"; amountCents: number; label: string };

const prices: Record<string, number> = {
  "5k_1": 4900, "5k_2": 3900, "5k_3": 2900,
  "10k_1": 9900, "10k_2": 7900, "10k_3": 5900,
  "25k_1": 22900, "25k_2": 19900, "25k_3": 14900,
  "50k_1": 39900, "50k_2": 34900, "50k_3": 27900,
  "100k_1": 69900, "100k_2": 54900, "100k_3": 44900,
  "200k_1": 119900, "200k_2": 99900, "200k_3": 79900,
};
const sizes: Record<string, number> = { "5k": 5000, "10k": 10000, "25k": 25000, "50k": 50000, "100k": 100000, "200k": 200000 };

export function getPlan(accountSize: unknown, phase: unknown): Plan | null {
  if (typeof accountSize !== "string" || typeof phase !== "string") return null;
  const amountCents = prices[`${accountSize}_${phase}`];
  const numericSize = sizes[accountSize];
  if (!amountCents || !numericSize || !["1", "2", "3"].includes(phase)) return null;
  return { accountSize: numericSize, phase: phase as Plan["phase"], amountCents, label: `$${accountSize.toUpperCase()} ${phase}-phase challenge` };
}
