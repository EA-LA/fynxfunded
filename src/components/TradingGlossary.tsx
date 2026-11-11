import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, BookOpen, Search, X } from "lucide-react";
import { glossaryGroups, glossaryTerms, searchGlossary, type GlossaryGroup } from "@/lib/glossary";

const chip = (active: boolean) =>
  `min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
  }`;

/**
 * Searchable glossary of the words used on the Rules, Challenges, Payouts and
 * dashboard pages. Each term has its own link (/faq#term-<id>).
 */
export default function TradingGlossary() {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GlossaryGroup | "all">("all");
  const [highlight, setHighlight] = useState<string | null>(null);

  const searched = useMemo(() => searchGlossary(query), [query]);
  const results = group === "all" ? searched : searched.filter((t) => t.group === group);
  const letters = useMemo(() => [...new Set(glossaryTerms.map((t) => t.term[0].toUpperCase()))], []);
  const filtering = query.trim() !== "" || group !== "all";

  // A shared link such as /faq#term-pip clears filters so the term is visible, then highlights it.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id.startsWith("term-") && glossaryTerms.some((t) => `term-${t.id}` === id)) {
      setQuery("");
      setGroup("all");
      setHighlight(id);
    }
  }, [location.hash]);

  return (
    <section id="glossary" aria-labelledby="glossary-title" className="mt-16 scroll-mt-24" data-testid="glossary">
      <h2 id="glossary-title" className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <BookOpen size={20} aria-hidden="true" /> Glossary
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {glossaryTerms.length} trading and evaluation terms in plain words. FYNX Funded figures come from the published new-account schedule; examples are simple arithmetic, not market prices.
      </p>

      <div role="search" aria-label="Glossary" className="relative mt-6 mb-3">
        <label htmlFor="glossary-search" className="sr-only">Search the glossary</label>
        <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          id="glossary-search"
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Look up a word, e.g. pip, equity, trailing"
          className="w-full rounded-md border border-input bg-background pl-9 pr-10 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-describedby="glossary-count"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear glossary search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <p id="glossary-count" className="mb-4 text-xs text-muted-foreground" aria-live="polite">
        {filtering ? `${results.length} of ${glossaryTerms.length} terms match` : `${glossaryTerms.length} terms`}
      </p>

      <div role="group" aria-label="Filter glossary by area" className="mb-4 flex flex-wrap gap-2">
        {[{ id: "all" as const, label: "All terms" }, ...glossaryGroups].map((g) => {
          const count = g.id === "all" ? searched.length : searched.filter((t) => t.group === g.id).length;
          return (
            <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)} className={chip(group === g.id)}>
              {g.label} <span>({count})</span>
            </button>
          );
        })}
      </div>

      {!filtering && (
        <nav aria-label="Glossary letters" className="mb-6 flex flex-wrap gap-1.5 text-xs">
          {letters.map((letter) => {
            const first = glossaryTerms.find((t) => t.term[0].toUpperCase() === letter)!;
            return (
              <a key={letter} href={`#term-${first.id}`} className="rounded border px-2 py-1 font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                {letter}
              </a>
            );
          })}
        </nav>
      )}

      {results.length ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          {results.map((t) => {
            const id = `term-${t.id}`;
            return (
              <div
                key={t.id}
                id={id}
                className={`premium-card scroll-mt-24 ${highlight === id ? "ring-2 ring-primary" : ""}`}
                data-testid="glossary-term"
              >
                <dt className="text-sm font-semibold">
                  <a href={`#${id}`} className="hover:underline underline-offset-4">{t.term}</a>
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.definition}</dd>
                {t.link && (
                  <dd className="mt-3 text-xs">
                    <Link to={t.link.to} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline underline-offset-4">
                      {t.link.label} <ArrowRight size={12} aria-hidden="true" />
                    </Link>
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="premium-card text-sm text-muted-foreground">
          <p>No terms match "{query}". Try a shorter word, or search the questions above.</p>
          {group !== "all" && (
            <button type="button" onClick={() => setGroup("all")} className="mt-3 text-xs font-medium text-foreground underline underline-offset-4">
              Search all terms
            </button>
          )}
        </div>
      )}
    </section>
  );
}
