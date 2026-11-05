import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import MarketingLayout from "@/components/MarketingLayout";
import TradingGlossary from "@/components/TradingGlossary";
import { faqItems } from "@/lib/mockData";
import { faqTopics, type FaqTopicId } from "@/lib/faqContent";
import { filterFaq } from "@/lib/faqSearch";
import { ArrowRight, Check, ChevronRight, Link2, Mail, Search, X } from "lucide-react";

const FAQ_SCHEMA_ID = "faq-schema";

const relatedPages = [
  { to: "/rules#calculator", label: "Rules calculator", description: "Your targets, loss floors and consistency in dollars." },
  { to: "/how-it-works", label: "How it works", description: "The evaluation journey step by step." },
  { to: "/challenges", label: "Challenges & pricing", description: "Compare account sizes and programs." },
  { to: "/payouts", label: "Payouts", description: "How payout requests work." },
];

export default function FAQ() {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<FaqTopicId | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const searched = useMemo(() => filterFaq(faqItems, query), [query]);
  const results = useMemo(() => (topic === "all" ? searched : searched.filter((item) => item.topic === topic)), [searched, topic]);
  const filtering = query.trim() !== "" || topic !== "all";
  const groups = faqTopics
    .map((t) => ({ ...t, items: results.filter((item) => item.topic === t.id) }))
    .filter((g) => g.items.length > 0);

  // Open the question named in the address (e.g. /faq#daily-reset) so answers can be shared.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && faqItems.some((item) => item.id === id)) setOpenId(id);
  }, [location.hash]);

  const copyLink = async (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.location.hash = id;
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
  };

  const countText = filtering
    ? `${results.length} of ${faqItems.length} questions match`
    : `${faqItems.length} questions in ${faqTopics.length} topics`;

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
          Everything you need to know about FYNX Funded. New to a word?{" "}
          <a href="#glossary" className="font-medium text-foreground underline underline-offset-4">See the glossary</a>.
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
          {countText}
        </p>

        <div role="group" aria-label="Filter by topic" className="mb-8 flex flex-wrap gap-2">
          {[{ id: "all" as const, label: "All topics" }, ...faqTopics].map((t) => {
            const count = t.id === "all" ? searched.length : searched.filter((item) => item.topic === t.id).length;
            const active = topic === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTopic(t.id)}
                className={`min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {t.label} <span className={active ? "opacity-80" : "opacity-60"}>({count})</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-10">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`topic-${group.id}`}>
              <h2 id={`topic-${group.id}`} className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h2>
              <div className="space-y-4">
                {group.items.map((faq) => {
                  const isOpen = openId === faq.id || (query.trim() !== "" && results.length <= 3);
                  return (
                    <details
                      key={faq.id}
                      id={faq.id}
                      className="group premium-card cursor-pointer scroll-mt-24"
                      open={isOpen}
                      onToggle={(e) => {
                        const nowOpen = (e.currentTarget as HTMLDetailsElement).open;
                        if (nowOpen && openId !== faq.id) setOpenId(faq.id);
                        if (!nowOpen && openId === faq.id) setOpenId(null);
                      }}
                    >
                      <summary className="flex items-center justify-between text-sm font-medium list-none">
                        {faq.q}
                        <ChevronRight size={16} aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90 shrink-0 ml-4" />
                      </summary>
                      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                        {faq.link && (
                          <Link to={faq.link.to} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline underline-offset-4">
                            {faq.link.label} <ArrowRight size={12} aria-hidden="true" />
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => copyLink(faq.id)}
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          aria-label={`Copy link to "${faq.q}"`}
                        >
                          {copiedId === faq.id ? <Check size={12} aria-hidden="true" /> : <Link2 size={12} aria-hidden="true" />}
                          {copiedId === faq.id ? "Link copied" : "Copy link"}
                        </button>
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          ))}
          {results.length === 0 && (
            <div className="premium-card text-sm text-muted-foreground">
              <p>
                No questions match "{query}"{topic !== "all" ? ` in ${faqTopics.find((t) => t.id === topic)?.label}` : ""}. Try a shorter word, browse the pages below, or ask our support team.
              </p>
              {topic !== "all" && (
                <button type="button" onClick={() => setTopic("all")} className="mt-3 text-xs font-medium text-foreground underline underline-offset-4">
                  Search all topics
                </button>
              )}
            </div>
          )}
        </div>

        <TradingGlossary />

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
