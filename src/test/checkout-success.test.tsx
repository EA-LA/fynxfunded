import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ user: { userId: "a" } as { userId: string } | null, auth: { currentUser: { uid: "a", getIdToken: vi.fn().mockResolvedValue("test-token") } }, fetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: fake.user, loading: false }) }));
vi.mock("@/lib/firebase", () => ({ auth: fake.auth }));
vi.mock("@/services/payments", () => ({ downloadReceipt: vi.fn() }));
import CheckoutSuccess from "@/pages/CheckoutSuccess";
const show = () => render(<MemoryRouter initialEntries={["/checkout/success?session_id=cs_test_one"]}><CheckoutSuccess /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); fake.user = { userId: "a" }; fake.auth.currentUser.uid = "a"; vi.stubGlobal("fetch", fake.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
describe("payment return recovery", () => {
  it("shows fulfillment pending without a receipt and retries safely", async () => {
    fake.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ verified: true, status: "paid", order: null }) });
    fake.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ verified: true, status: "paid", order: { userId: "a", status: "paid", challengeId: "c", challenge: "Test order", amount: 79, paymentMethod: "card" } }) });
    show(); expect(await screen.findByText("Payment received — order processing")).toBeInTheDocument(); expect(screen.queryByText("Download Receipt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check order status" })); expect(await screen.findByText("Download Receipt")).toBeInTheDocument(); expect(fake.fetch).toHaveBeenCalledTimes(2);
  });
  it("does not use an unrelated local order after a failed session", async () => {
    localStorage.setItem("fynx_last_order_id", "someone-elses-order"); fake.fetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    show(); expect(await screen.findByText("Payment not verified")).toBeInTheDocument(); expect(screen.queryByText("Download Receipt")).not.toBeInTheDocument();
  });
  it("ignores an old response when the customer changes", async () => {
    let finish: (value: unknown) => void = () => {};
    fake.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: false, json: async () => ({}) });
    const view = show(); await act(async () => {});
    fake.user = { userId: "b" }; fake.auth.currentUser.uid = "b";
    view.rerender(<MemoryRouter><CheckoutSuccess /></MemoryRouter>);
    await act(async () => finish({ ok: true, json: async () => ({ verified: true, status: "paid", order: { userId: "a", status: "paid", challengeId: "private" } }) }));
    expect(screen.queryByText("Thank you for your purchase")).not.toBeInTheDocument(); expect(screen.queryByText("Download Receipt")).not.toBeInTheDocument();
  });
});
