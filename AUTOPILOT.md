# Autopilot backlog (fynxfunded)

Prioritized, page by page. One to three focused changes per run. Safety: no changes to Firestore rules, auth/MFA, payments/checkout, trade fills, balances or evaluation outcomes.

## Site-wide
- [x] Friendly 404 page with navigation, helpful links and correct title/noindex (2026-11-03)
- [x] Footer "Trade Now" spacing fix (2026-11-03)
- [ ] Footer "Discord" / "Twitter" are plain text, not links: link them once real URLs are confirmed (or hide)
- [ ] Footer support email: make it a clickable mailto link (it wraps mid-word on phones)
- [ ] Mobile: ecosystem footer list has very tall spacing on phones; tighten it
- [ ] Performance: main bundle chunk is >500 kB; split heavy routes/libs further
- [ ] Accessibility pass (skip-to-content link, focus outlines, heading order)
- [ ] Translate 404, FAQ and calculator into the languages offered by the language selector

## Home (/)
- [ ] Review hero and plan cards on mobile; add a short "how the rules work" teaser linking to the calculator
- [ ] Home plan cards: add "See the rules in dollars" links (calculatorLink helper exists)

## Challenges (/challenges)
- [x] Side-by-side comparison of 1/2/3-phase programs for a chosen size, in dollars (2026-11-03)
- [x] Link each plan to the rules calculator preset for that size/program (2026-11-03)
- [ ] Let "Start challenge" preselect size/program in the builder (needs care: builder feeds checkout)

## How it works (/how-it-works)
- [x] Program/size picker showing every phase in dollars, plus "How a trading day works" (2026-11-03)
- [ ] Make the chosen program/size shareable in the URL

## Trading rules (/rules)
- [x] Rules calculator: targets/floors in dollars, today's loss floor, 40% consistency check (2026-11-03)
- [x] Let the calculator pick which phase you're in (2026-11-03)
- [x] Accept size/program/phase from the URL and keep the address shareable (2026-11-03)

## Payouts (/payouts)
- [x] Payout split estimator from approved profit-split table, clearly labelled estimate (2026-11-03)
- [x] Fix incomplete profit-split tiers: full size × program table from the catalog (2026-11-03)
- [ ] Payout calendar: show the next request window based on today's date

## FAQ (/faq)
- [x] Search, FAQPage structured data, related links and "Email support" block (2026-11-03)
- [ ] Group questions by topic and add accurate answers on consistency, daily reset time and loss floors

## Legal pages (/terms, /privacy, /risk-disclosure, /refund-policy, /aml-kyc)
- [ ] Add table of contents with anchor links and "last updated" date

## Dashboard (/dashboard/*)
- [ ] Walk signed-in pages with emulator data; check empty states on mobile
- [ ] Add tests covering public marketing pages render (Index, Challenges, Rules, Payouts)
