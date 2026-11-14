import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import RulesPage from "@/pages/Rules";
import GlossaryTip from "@/components/GlossaryTip";
import SearchMetadata from "@/components/SearchMetadata";
import { getGlossaryTerm, glossaryTermLink, glossaryTerms } from "@/lib/glossary";
import { privatePageTitle } from "@/lib/pageTitles";

afterEach(cleanup);

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.hash}</p>;
}

describe("glossary lookups", () => {
  it("finds every listed term by id and builds its FAQ address", () => {
    for (const t of glossaryTerms) expect(getGlossaryTerm(t.id)).toBe(t);
    expect(getGlossaryTerm("not-a-term")).toBeUndefined();
    expect(glossaryTermLink("pip")).toBe("/faq#term-pip");
  });
});

describe("GlossaryTip", () => {
  it("opens the plain-language definition and links to the full entry", () => {
    render(
      <MemoryRouter initialEntries={["/rules"]}>
        <GlossaryTip term="equity">equity</GlossaryTip>
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>,
    );
    const trigger = screen.getByRole("button", { name: /equity: What does "equity" mean\?/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(getGlossaryTerm("equity")!.definition)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("link", { name: /Open in the glossary/ }));
    expect(screen.getByTestId("where").textContent).toBe("/faq#term-equity");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a question-mark button when no words are given, and the term's own next step", () => {
    render(<MemoryRouter><GlossaryTip term="kyc" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: 'What does "KYC (identity verification)" mean?' }));
    expect(screen.getByRole("link", { name: /Read the AML\/KYC policy/ }).getAttribute("href")).toBe("/aml-kyc");
  });

  it("renders plain text for an unknown term instead of breaking", () => {
    render(<MemoryRouter><GlossaryTip term="nope">just words</GlossaryTip></MemoryRouter>);
    expect(screen.getByText("just words")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("glossary help on the Rules page and calculators", () => {
  it("explains the schedule headings, each rule's words and the calculator labels", () => {
    const { container } = render(<I18nProvider><MemoryRouter initialEntries={["/rules"]}><RulesPage /></MemoryRouter></I18nProvider>);
    expect(screen.getByRole("link", { name: "browse the full glossary" }).getAttribute("href")).toBe("/faq#glossary");
    const used = new Set([...container.querySelectorAll("[data-glossary-term]")].map((el) => el.getAttribute("data-glossary-term")));
    for (const id of [
      "profit-target", "daily-loss-limit", "maximum-loss", "minimum-trading-days", "consistency-rule", "daily-reset",
      "risk-per-trade", "risk-reward", "break-even-win-rate", "stop-loss", "lot", "take-profit", "win-rate", "commission",
    ]) expect(used.has(id), id).toBe(true);
    // Every id used on the page is a real glossary entry.
    for (const id of used) expect(getGlossaryTerm(id!), id!).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: 'What does "break-even win rate" mean?' }));
    expect(screen.getByRole("dialog").textContent).toContain("Break-even win rate");
  });
});

describe("browser tab names", () => {
  it("names private pages instead of calling them all Account", () => {
    expect(privatePageTitle("/login")).toBe("Log in");
    expect(privatePageTitle("/signup")).toBe("Create your account");
    expect(privatePageTitle("/certificates/verify")).toBe("Verify a certificate");
    expect(privatePageTitle("/certificates/verify/FYNX-CERT-1")).toBe("Verify a certificate");
    expect(privatePageTitle("/checkout/success")).toBe("Order received");
    expect(privatePageTitle("/checkout")).toBe("Checkout");
    expect(privatePageTitle("/dashboard")).toBe("Dashboard");
    expect(privatePageTitle("/dashboard/analytics")).toBe("Analytics · Dashboard");
    expect(privatePageTitle("/dashboard/accounts/abc123")).toBe("Account workspace");
    expect(privatePageTitle("/account")).toBe("Account");
    expect(privatePageTitle("/something-else")).toBe("Account");
  });

  it("sets the tab title and keeps private pages out of search engines", () => {
    document.head.innerHTML = '<meta name="robots" content="index, follow">';
    render(<MemoryRouter initialEntries={["/login"]}><SearchMetadata platform /></MemoryRouter>);
    expect(document.title).toBe("Log in | FYNX Funded");
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    cleanup();
    render(<MemoryRouter initialEntries={["/rules"]}><SearchMetadata platform /></MemoryRouter>);
    expect(document.title).toBe("Trading Rules & Drawdown Limits | FYNX Funded");
  });
});
