import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ call: vi.fn(), uid: "a" }));
vi.mock("@/lib/firebase", () => ({ functions: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: fake.uid } }) }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => fake.call }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, Area: () => null, AreaChart: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
import AccountEquityHistory from "@/components/AccountEquityHistory";
const base = { phase: 1, status: "awaiting_history", currency: "USD", points: [], snapshot: null, authorizesTrading: false, authorizesPayout: false };
beforeEach(() => { vi.clearAllMocks(); fake.uid = "a"; }); afterEach(cleanup);
it("keeps missing equity unavailable rather than inferring balances", async () => {
  fake.call.mockResolvedValue({ data: base }); render(<AccountEquityHistory challengeId="c" program="2-phase"/>);
  expect(await screen.findByText(/not available for this phase/)).toBeInTheDocument(); expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
});
it("labels old history by its broker time, including zero values and recorded breaches", async () => {
  fake.call.mockResolvedValue({ data: { ...base, status: "recent_snapshot", snapshot: { asOf: Date.now() - 120000, balance: "0", equity: "0", dailyRemaining: "-10", maximumRemaining: "0", breached: true, policyVersion: "recorded-v1" }, eventCount: 5 } });
  render(<AccountEquityHistory challengeId="c" program="2-phase"/>);
  expect(await screen.findByText(/Historical broker snapshot/)).toBeInTheDocument(); expect(screen.getAllByText("$0.00")).toHaveLength(3); expect(screen.getByText(/A breach is recorded/)).toBeInTheDocument();
});
it("loads the requested historical phase and clears the previous phase", async () => {
  fake.call.mockResolvedValueOnce({ data: base }).mockResolvedValueOnce({ data: { ...base, phase: 2, status: "review_required" } });
  render(<AccountEquityHistory challengeId="c" program="2-phase"/>); await screen.findByText(/not available for this phase/);
  fireEvent.change(screen.getByRole("combobox", { name: "History phase" }), { target: { value: "2" } });
  expect(await screen.findByText(/These records need review/)).toBeInTheDocument(); expect(fake.call).toHaveBeenLastCalledWith({ challengeId: "c", phase: 2 });
});
it("ignores an old customer's history response", async () => {
  let finish: (value: unknown) => void = () => {};
  fake.call.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ data: base });
  const view = render(<AccountEquityHistory challengeId="c" program="1-phase"/>); fake.uid = "b"; view.rerender(<AccountEquityHistory challengeId="other" program="1-phase"/>);
  await act(async () => finish({ data: { ...base, status: "review_required" } })); expect(await screen.findByText(/not available for this phase/)).toBeInTheDocument(); expect(screen.queryByText(/These records need review/)).not.toBeInTheDocument();
});
it("surfaces verification failures without displaying a balance", async () => {
  fake.call.mockRejectedValue(Error("unavailable")); render(<AccountEquityHistory challengeId="c" program="1-phase"/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified"); expect(screen.queryByText("Recorded equity")).not.toBeInTheDocument();
});
