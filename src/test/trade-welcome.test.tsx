import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
import TradeWelcome from "@/pages/TradeWelcome";
import EcosystemSwitch from "@/components/EcosystemSwitch";

afterEach(cleanup);
const show = () => render(<MemoryRouter initialEntries={["/trade"]}><TradeWelcome /></MemoryRouter>);

describe("FYNX Trade welcome page", () => {
  it("sends every Trade now button to the terminal", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Every forex pair.One deliberate terminal.");
    const buttons = [...screen.getAllByRole("link", { name: /Trade now/ }), ...screen.getAllByRole("link", { name: /Open the terminal|Explore the terminal|Open the web terminal/ })];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    buttons.forEach(b => expect(b).toHaveAttribute("href", "/trade/access"));
    expect(screen.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login?next=%2Ftrade%2Faccess");
  });

  it("lists the pairs in a filterable table that opens each one in the terminal", () => {
    show();
    const table = screen.getByTestId("markets-table");
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    fireEvent.click(screen.getByRole("button", { name: "Show all 45 pairs" }));
    expect(within(table).getAllByRole("row")).toHaveLength(46);
    fireEvent.click(screen.getByRole("button", { name: /^Exotics/ }));
    expect(within(table).getAllByRole("row")).toHaveLength(18);
    fireEvent.change(screen.getByLabelText("Filter pairs"), { target: { value: "rand" } });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByRole("link", { name: "Open USD/ZAR in the terminal" })).toHaveAttribute("href", "/trade/access?symbol=USDZAR");
    expect(within(table).getByText("Moves with ZAR/USD")).toBeInTheDocument();
  });

  it("searches pairs from the hero", () => {
    show();
    fireEvent.change(screen.getByLabelText("Find a forex pair"), { target: { value: "gbp/jpy" } });
    expect(within(screen.getByRole("search")).getByRole("link", { name: /GBP\/JPY/ })).toHaveAttribute("href", "/trade/access?symbol=GBPJPY");
  });

  it("shows live session status for the four centres", () => {
    show();
    const strip = screen.getByTestId("session-strip");
    for (const city of ["Sydney", "Tokyo", "London", "New York"]) expect(strip).toHaveTextContent(city);
  });

  it("is honest that trading is not open yet", () => {
    show();
    expect(screen.getByText(/Trading opens soon/)).toBeInTheDocument();
    expect(screen.getByText(/Until then no order is sent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Do I need to download anything?" }));
    expect(screen.getByText(/runs in your web browser/)).toBeInTheDocument();
    expect(screen.queryByText(/Until then no order is sent/)).toBeNull();
    expect(screen.getByRole("link", { name: /partnership/ })).toHaveAttribute("href", expect.stringContaining("mailto:support@fynxfunded.com"));
  });
});

describe("ecosystem switch", () => {
  it("links FYNX Trade and marks the current platform", () => {
    render(<MemoryRouter initialEntries={["/trade"]}><EcosystemSwitch /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "FYNX Ecosystem" }));
    expect(screen.getByText("FYNX Trade").closest("[aria-current]")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /FYNX Funded/ })).toHaveAttribute("href", "/");
  });
});

import { TRADING_CENTRES, centreStatus, formatMinutes } from "@/trade-access/sessions";
describe("trading centre hours", () => {
  const c = (id: string) => TRADING_CENTRES.find(t => t.id === id)!;
  it("uses local time with daylight saving", () => {
    // Wed 4 Nov 2026 14:30 UTC = 14:30 London (GMT), 09:30 New York (EST)
    const now = new Date("2026-11-04T14:30:00Z");
    expect(centreStatus(c("london"), now)).toMatchObject({ open: true, localTime: "14:30", minutesToChange: 150 });
    expect(centreStatus(c("new-york"), now)).toMatchObject({ open: true, localTime: "09:30", minutesToChange: 450 });
    expect(centreStatus(c("tokyo"), now)).toMatchObject({ open: false, localTime: "23:30", minutesToChange: null });
    // July: London on BST (UTC+1)
    expect(centreStatus(c("london"), new Date("2026-07-01T07:30:00Z"))).toMatchObject({ open: true, localTime: "08:30" });
  });
  it("counts down to the opening on the same day and is closed at weekends", () => {
    expect(centreStatus(c("london"), new Date("2026-11-04T07:15:00Z"))).toMatchObject({ open: false, minutesToChange: 45 });
    expect(centreStatus(c("london"), new Date("2026-11-07T12:00:00Z"))).toMatchObject({ open: false, minutesToChange: null });
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(150)).toBe("2h 30m");
  });
});
