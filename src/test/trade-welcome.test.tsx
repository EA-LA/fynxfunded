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
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Trade forex.Right in your browser.");
    const buttons = screen.getAllByRole("link", { name: /Trade now/ });
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    buttons.forEach(b => expect(b).toHaveAttribute("href", "/trade/access"));
    expect(screen.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login?next=%2Ftrade%2Faccess");
  });

  it("lists every forex pair and links each one into the terminal", () => {
    show();
    const markets = screen.getByRole("region", { name: "45 forex pairs." });
    const links = within(markets).getAllByRole("link");
    expect(links).toHaveLength(45);
    expect(within(markets).getByRole("link", { name: "GBP/JPY" })).toHaveAttribute("href", "/trade/access?symbol=GBPJPY");
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
