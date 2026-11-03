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

## Challenges (/challenges)
- [ ] Side-by-side comparison of 1/2/3-phase programs for a chosen size (targets, limits, split, price) using challengeConfig
- [ ] Link each plan to the rules calculator preset for that size/program (e.g. /rules?size=25000&program=2-phase#calculator)

## How it works (/how-it-works)
- [ ] Page is short (74 lines): add a visual timeline per program with phase targets and minimum days

## Trading rules (/rules)
- [x] Rules calculator: targets/floors in dollars, today's loss floor, 40% consistency check (2026-11-03)
- [ ] Let the calculator pick which phase you're in (targets after phase 1)
- [ ] Accept size/program from the URL so other pages can deep-link

## Payouts (/payouts)
- [ ] Payout split estimator from approved profit-split table (clearly labelled estimate, no promises)

## FAQ (/faq)
- [x] Search, FAQPage structured data, related links and "Email support" block (2026-11-03)
- [ ] Group questions by topic and add accurate answers on consistency, daily reset time and loss floors

## Legal pages (/terms, /privacy, /risk-disclosure, /refund-policy, /aml-kyc)
- [ ] Add table of contents with anchor links and "last updated" date

## Dashboard (/dashboard/*)
- [ ] Walk signed-in pages with emulator data; check empty states on mobile
- [ ] Add tests covering public marketing pages render (Index, Challenges, Rules, Payouts)
