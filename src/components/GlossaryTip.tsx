import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getGlossaryTerm, glossaryTermLink } from "@/lib/glossary";
import { cn } from "@/lib/utils";

interface GlossaryTipProps {
  /** Glossary term id (see src/lib/glossary.ts). */
  term: string;
  /** Words to show as the trigger. Without them a small "?" button is shown. */
  children?: ReactNode;
  className?: string;
}

/**
 * Explains a trading or rules word in place: tap, click or press Enter on it to
 * see the plain-language glossary definition, with a link to the full entry on
 * /faq#term-<id>. Works on touch screens (no hover needed).
 */
export default function GlossaryTip({ term, children, className }: GlossaryTipProps) {
  const [open, setOpen] = useState(false);
  const entry = getGlossaryTerm(term);
  if (!entry) return <>{children ?? null}</>;
  // Sentence case ("win rate", but "KYC") so the button reads naturally after the visible label.
  const spoken = /^[A-Z]{2}/.test(entry.term) ? entry.term : entry.term.charAt(0).toLowerCase() + entry.term.slice(1);
  const label = `What does "${spoken}" mean?`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ? (
          <button
            type="button"
            aria-label={`${typeof children === "string" ? children : spoken}: ${label}`}
            className={cn(
              "inline cursor-help rounded-sm text-left underline decoration-dotted decoration-muted-foreground/70 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
            data-glossary-term={term}
          >
            {children}
          </button>
        ) : (
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
            data-glossary-term={term}
          >
            <HelpCircle size={14} aria-hidden="true" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] text-sm" collisionPadding={16}>
        <p className="font-semibold">{entry.term}</p>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">{entry.definition}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
          <Link to={glossaryTermLink(entry.id)} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 underline underline-offset-4">
            Open in the glossary <ArrowRight size={12} aria-hidden="true" />
          </Link>
          {entry.link && (
            <Link to={entry.link.to} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 underline underline-offset-4">
              {entry.link.label} <ArrowRight size={12} aria-hidden="true" />
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
