import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const kyc = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { userId: "test-user", email: "test@example.com", country: "United States", kycStatus: "pending" } }) }));
vi.mock("@/services/kyc", () => ({ submitKycProfile: kyc.create, refreshKycStatus: kyc.refresh, watchCurrentUserKyc: (_uid: string, cb: any) => { cb({ kycStatus: "pending" }); return () => {}; } }));
import Verification from "@/pages/Verification";
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState({}, "", "/verification"); });
afterEach(cleanup);
describe("Verification page", () => {
  it("shows an incomplete return accurately", async () => {
    window.history.replaceState({}, "", "/verification?verification-return=1"); kyc.refresh.mockResolvedValue({ status: "requires_input" });
    render(<MemoryRouter><Verification /></MemoryRouter>);
    expect(await screen.findByText(/Verification is incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/documents were submitted/)).not.toBeInTheDocument();
  });
  it("explains an already processing session", async () => {
    kyc.create.mockResolvedValue({ sessionId: "vs_test", status: "processing" });
    render(<MemoryRouter><Verification /></MemoryRouter>); fireEvent.click(screen.getByRole("button", { name: "Resume Verification" }));
    expect(await screen.findByText(/Stripe is reviewing/)).toBeInTheDocument();
  });
  it("offers a manual status refresh", async () => {
    kyc.refresh.mockResolvedValue({ status: "verified" }); render(<MemoryRouter><Verification /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(kyc.refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Other payout requirements still apply/)).toBeInTheDocument();
  });
  it("shows the live activation blocker clearly", async () => {
    kyc.create.mockRejectedValue(new Error("Identity verification is awaiting live Stripe activation. Please contact support."));
    render(<MemoryRouter><Verification /></MemoryRouter>); fireEvent.click(screen.getByRole("button", { name: "Resume Verification" }));
    expect(await screen.findByText(/awaiting live Stripe activation/)).toBeInTheDocument();
  });
});
