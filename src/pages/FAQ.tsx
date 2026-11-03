import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import MarketingLayout from "@/components/MarketingLayout";
import { faqItems } from "@/lib/mockData";
import { filterFaq } from "@/lib/faqSearch";
import { ChevronRight, Mail, Search, X } from "lucide-react";

const FAQ_SCHEMA_ID = "faq-schema";

const relatedPages = [
  { to: "/rules#calculator", label: "Rules calculator", description: "Your targets, loss floors and consistency in dollars." },
  { to: "/how-it-works", label: "How it works", description: "The evaluation journey step by step." },
  { to: "/challenges", label: "Challenges & pricing", description: "Compare account sizes and programs." },
  { to: "/payouts", label: "Payouts", description: "How payout requests work." },
];

export default function FAQ() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => filterFaq(faqItems, query), [query]);

  useEffect(() => {
    const schema = document.createElement("script");
    schema.id = FAQ_SCHEMA_ID;
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
    document.getElementById(FAQ_SCHEMA_ID)?.remove();
    document.head.append(schema);
    return () => schema.remove();
  }, []);

  return (
    <MarketingLayout>
      <section className="max-w-3xl mx-auto px-6 py-24 md:py-32">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 animate-fade-up">FAQ</h1>
        <p className="text-lg text-muted-foreground mb-10 animate-fade-up delay-200">
          Everything you need to know about FYNX Funded.
        </p>

        <div role="search" className="relative mb-3">
          <label htmlFor="faq-search" className="sr-only">Search questions</label>
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="faq-search"
            type="text"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions, e.g. weekend, refund, payout"
            className="w-full rounded-md border border-input bg-background pl-9 pr-10 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-describedby="faq-count"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <p id="faq-count" className="mb-6 text-xs text-muted-foreground" aria-live="polite">
          {query ? `${results.length} of ${faqItems.length} questions match` : `${faqItems.length} questions`}
        </p>

        <div className="space-y-4">
          {results.map((faq) => (
            <details key={faq.q} className="group premium-card cursor-pointer" open={query.trim() !== "" && results.length <= 3}>
              <summary className="flex items-center justify-between text-sm font-medium list-none">
                {faq.q}
                <ChevronRight size={16} aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90 shrink-0 ml-4" />
              </summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
            </details>
          ))}
          {results.length === 0 && (
            <div className="premium-card text-sm text-muted-foreground">
              No questions match "{query}". Try a shorter word, browse the pages below, or ask our support team.
            </div>
          )}
        </div>

        <nav aria-label="Related pages" className="mt-16">
          <h2 className="text-sm font-semibold mb-4">Keep exploring</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {relatedPages.map((page) => (
              <li key={page.to}>
                <Link to={page.to} className="premium-card block h-full">
                  <span className="block text-sm font-medium">{page.label}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{page.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="premium-card mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Still have questions?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Email us and we'll help with anything not covered here.</p>
          </div>
          <a
            href="mailto:support@fynxfunded.com"
            className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Mail size={16} aria-hidden="true" /> Email support
          </a>
        </div>
      </section>
    </MarketingLayout>
  );
}
