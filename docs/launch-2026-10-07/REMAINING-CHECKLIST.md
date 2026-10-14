# FYNX Funded — remaining launch checklist

Updated October 7, 2026. Covers the Funded website, backend and iOS app. This supersedes older unchecked implementation items. Launch/rollback owner: Elham Amini. Final commercial launch remains unapproved; purchases remain paused.

## Completed or advanced in this session

- [x] Deployed nine selected Funded services: customer actions, workspace, leaderboard job, MFA callable, native checkout, native Identity entry point, privacy, and both progression safeguards.
- [x] Blocked manual pass/fund from bypassing the pending evidence/transition workflow. Verified owner authentication, transactionally read versioned events, and made manual failure/audit evidence persistent and atomic.
- [x] Implemented scoped authenticated data export plus deletion-request intake/status. Twelve live QA checks passed and temporary records were removed. Deletion execution remains pending.
- [x] Verified current PITR, daily/weekly backup schedules and 18 READY backups; checked enabled monitoring configuration. Alert delivery and deletion-aware restoration remain open.
- [x] Passed clean release lint, 28 frontend tests, 35 functions tests, backend/frontend TypeScript checks and production build. Fixed the CI type errors. [Remote CI passed](https://github.com/EA-LA/fynxfunded/actions/runs/37677584720); [release PR merged](https://github.com/EA-LA/fynxfunded/pull/11).
- [x] Built the current complete iOS app, signed it, installed it and launched it on the connected iPhone. Owner reports that sign-in, Tools/Funded switching and Face ID/passcode locking work. This is owner-reported device evidence, not independent exhaustive testing.
- [x] Created the signed Release archive and exported the local App Store IPA (version 1.3, build 1). Nothing was uploaded or submitted to Apple.
- [x] Confirmed that dedicated Trader's Analysis, scenario lab, Funded market desk and technical localization across 20 languages were already implemented. They should no longer be listed as missing features.
- [x] Rechecked production public rule wording and mobile rules/navigation/login rendering at 390px, with no page overflow.

## Still required

- [ ] **Broker approval and specifications:** obtain production/Funded suitability approval and the dated instrument catalog, including contracts, leverage, costs and sessions. Existing OANDA practice evidence does not approve production trading.
- [ ] **Real broker integration:** supply/import complete account history with independent balances, costs, live equity and exact daily-reset coverage. Production currently has five challenges and no broker accounts, trades or rule events. Complete reconciliation and show freshness honestly in the app.
- [ ] **Seven-day parallel proof:** run seven elapsed days across at least five complete accounts and 100 distinct accepted events, with no unexplained discrepancies. This has not been started or manufactured from replay timestamps.
- [ ] **Phase transitions:** implement/review the production transactional transition and new-phase broker binding, retain immutable old-phase evidence, and approve the concrete integration and rollback. Automatic progression and manual pass/fund remain paused.
- [ ] **Coordinated MFA activation:** merge the compatible website authentication and current production rules, verify signing permissions, activate the rollout, and test enrollment, migration, wrong/replayed codes, recovery, expiry, logout and both web/native entry points. The callable is deployed; activation is deliberately off.
- [ ] **Payments and native Identity:** configure matching approved Stripe keys and native Identity entitlement, deploy/verify PaymentIntent webhook fulfillment, and complete hosted/native checkout, retries, cancellation/recovery, document/selfie capture and separately authorized live payment tests. Funded challenges are one-time purchases; paid Premium/coaching subscriptions and renewals need an approved billing specification and implementation.
- [ ] **Legal/billing release:** obtain qualified legal review, approve taxes/refunds/recurring consent where applicable, settle the public business-contact arrangement, publish exact approved Funded terms/privacy and record full legal acceptance. FYNX LLC/Elham Amini are recorded from owner information; numerical-rule acceptance is not complete legal acceptance.
- [ ] **Retention and restore handling:** approve record-specific retention/holds, implement and verify deletion execution and an independently preserved deletion ledger, then verify suppression of deleted records during an isolated restoration. Request intake/export and a written procedure are done; destructive lifecycle execution is not.
- [ ] **Real account content:** supply actual payout dates/allowances, historical phase balances/evaluations, equity series, issued contracts, approved Premium terms, coaching availability and verified partner/social content. Empty records are not substituted with invented values.
- [ ] **Background account notifications:** implement and verify server-triggered APNs delivery for Funded account events; the existing in-app inbox does not establish background delivery.
- [ ] **Economic-calendar actuals/history:** supply the entitled provider key/subscription and approved date coverage, deploy the prepared adapter and test authenticated results. Public fallback data still lacks actual results.
- [ ] **Full customer and external beta QA:** compare a real customer's website/iOS records; test Apple, Google and email signup/verification, session expiry/switching/logout, offline/reconnection, actual five-second transition timing, trading credentials and payment/Identity interruptions. Complete independent beta feedback. Owner's successful basic-device check does not cover all these cases.
- [ ] **Language review:** native-speaker review of financial/security terminology and complete localized interaction/accessibility QA. Technical catalog coverage and sample renders already pass; legal/external content is not automatically translated.
- [ ] **Operational sign-off:** verify alert receipt, incident response and support ownership in practice, and rehearse the concrete recovery/rollback. Backup availability alone is insufficient.
- [ ] **Apple distribution and final launch:** check version/build uniqueness, App Store privacy/export-compliance details, review the signed package, upload to TestFlight, complete beta/release review and obtain final launch approval. Local packaging and physical installation are complete.

## Evidence and package locations

- Backend deployment: `services-deployment.json`; operational inventory: `operations.json`; live QA: `live-service-checks.json` (same directory).
- iOS archive: `/Users/h/.codex/workspaces/default/fynx-funded-ios-release/FYNX.xcarchive`.
- App Store package: `/Users/h/.codex/workspaces/default/fynx-funded-ios-release/AppStore/FYNX.ipa`.
- Package hash and device evidence: `/Users/h/.codex/workspaces/default/fynx-funded-ios-release/verification.json`.
- Clean reviewed source: `/Users/h/.codex/workspaces/default/fynx-funded-release-20261007`.

The related FYNX API product has separate subscription/retention work and may have different live billing settings. Its test-clock or paid-subscription evidence is not counted as Funded checkout completion.
