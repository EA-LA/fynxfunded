import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Checkout from "@/pages/Checkout";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("payment hold", () => {
  it.each(["Credit / Debit Card", "PayPal", "Apple Pay", "Cryptocurrency"])("blocks %s without contacting a payment provider", (method) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<MemoryRouter><Checkout /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: method }));
    fireEvent.click(screen.getByRole("button", { name: /^Pay \$/ }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Please wait while we finish the final step");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue exploring" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
