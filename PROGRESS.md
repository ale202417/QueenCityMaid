# Queen City Maid Production Progress

Status values: `todo`, `in_progress`, `done`, `blocked`.

## Ordered Work

| ID | Feature | Depends on | Status |
|---|---|---|---|
| 1 | Repository, runtime, environment, and progress ledger | none | done |
| 2 | PostgreSQL schema, migrations, test database, and seed | 1 | done |
| 3 | Authentication, sessions, roles, and organization isolation | 2 | done |
| 4 | Shared validation, errors, audit history, and API documentation | 3 | done |
| 5 | Manager and cleaner application shell | 3 | done |
| 6 | Customers and properties | 4, 5 | done |
| 7 | Employees, rates, experience, availability, teams, and captains | 4, 5 | done |
| 8 | Service types and business settings | 4, 5 | done |
| 9 | Lead intake, SLA tracking, consent, and follow-up | 6, 8 | done |
| 10 | Quotes, items, approval, and follow-up | 9 | done |
| 11 | Bookings and recurring services | 7, 10 | done |
| 12 | Dispatch board, conflicts, teams, routes, and overrides | 11 | done |
| 13 | Cleaner route, check-in/out, issues, and duration history | 12 | done |
| 14 | Schedule changes, callouts, cancellation fees, and notifications | 12 | done |
| 15 | Charges, payments, allocations, credits, tips, and reminders | 13 | done |
| 16 | Time corrections, captain reimbursement, and payroll exports | 13, 15 | done |
| 17 | Excel import, reports, monitoring, backups, and security hardening | 6, 7, 16 | done |
| 18 | Full automated, responsive browser, and production-readiness verification | all | done |
| 19 | Provision persistent PostgreSQL for the live local demo | 2, 18 | done |
| 20 | Local database durability and security hardening | 19 | done |
| 21 | Customer service frequency and payment preferences | 6, 15 | done |
| 22 | Alternating-week crew schedule planner, flexible recurrence, moves, and service history | 11-14, 21 | done |
| 23 | Manager-entered two-week payroll, weekly hour sheets, reports, and history | 7, 16 | done |
| 24 | Daily payment decisions, financial reports, comparison analytics, and executive dashboard | 15, 17, 23 | done |
| 25 | Managed hosting blueprint, CI release gate, clean production bootstrap, and deployment smoke checks | 24 | done |
| 26 | Production service defaults and reliable customer/property saves | 25 | done |
| 27 | Cross-page save reliability, transaction safety, and page crash recovery | 26 | done |
| 28 | Server-side record pagination and search, property archiving, and scheduled-service editing | 27 | done |
| 29 | Recurring booking service-type override for an individual scheduled visit | 28 | done |
| 30 | Scoped recurring-service edits for one visit or all eligible future visits | 29 | done |
| 31 | Flexible recurrence rollover, open-slot placement, customer notes, and last-crew history | 30 | done |
| 32 | Customer cancellation with future-service shutdown and preserved history | 31 | done |
| 33 | Single-visit cancellation, route cleanup, reminder shutdown, and optional fee | 32 | done |
| 34 | Permanent Playwright workflow harness, role coverage, mobile checks, and CI gate | 33 | done |
| 35 | Individual multi-date services and scoped recurring date moves | 34 | done |
| 36 | End-to-end manager module audit and P0-P2 repairs | 35 | done |
| 37 | Reversible admin controls and record-level history | 36 | done |
| 38 | Final migration, CI, deployment, and production smoke gates | 37 | done |
| 39 | Admin automation release design, safety rules, and migration plan | 38 | done |
| 40 | Daily automation runner for schedule upkeep, service reminders, and balance reminders | 39 | done |
| 41 | Record-level dashboard action center for operational exceptions | 39 | done |
| 42 | Manager automation settings, manual run control, and run history UI | 40, 41 | done |
| 43 | Automation API, permission, isolation, idempotency, browser, and upgrade tests | 40-42 | done |
| 44 | Production release, deployment verification, and external smoke checks | 43 | done |
| 45 | Declined-payment and service-plan edit release design | 44 | done |
| 46 | Charge-specific payment recording, allocation, validation, and audit history | 45 | done |
| 47 | Editable recurring service plans with eligible future-visit synchronization | 45 | done |
| 48 | Manager UI controls and API/browser regression verification | 46, 47 | done |
| 49 | Production release, deployment verification, and external smoke checks | 48 | in_progress |

## Decisions

- The production application is separate from the Switchboard demo.
- Use a React web client, Node/Express API, and PostgreSQL.
- Use cookie-backed database sessions instead of browser token storage.
- Keep external SMS and mapping providers behind small boundaries until
  business-owned accounts and credentials are available.
- Keep payment handling as a ledger in v1; do not store payment credentials.
- Keep cleaner checklists informational, not completion gates.
- Treat the $16 captain amount as one daily gas reimbursement, not a bonus.
- Use native browser routing instead of React Router because currently available
  versions carried unresolved security advisories; `npm audit` is clean.
- Spreadsheet onboarding uses validated row imports instead of parsing workbook
  binaries on the server; this supports rows exported from the existing Excel
  files without expanding the production dependency surface.
- Production SMS and map credentials remain external configuration. Manual route
  order and travel estimates remain available without a map provider.
- Customer-facing service and balance reminder automations default off and
  require a manager to enable them. Recurring schedule upkeep defaults on
  because its existing generation path is idempotent and does not contact
  customers.
- Daily automation uses one claimed run per organization and calendar day,
  with manual runs recorded separately. It reuses existing schedule and
  notification idempotency keys instead of introducing a generic rule engine.
- The dashboard action center shows organization-scoped records that need a
  manager decision; automation does not silently assign crews, resolve issues,
  or mark payments.
- The live local demo uses a dedicated PostgreSQL 18 cluster on loopback port
  55432. Its data, credentials, logs, and backups are excluded from Git.
- Database migrations use a separate owner role; the live web process uses a
  DML-only role without schema creation, role creation, database creation, or
  superuser privileges.
- Verified local backups run nightly with 30-day retention. Managed off-machine
  backups, point-in-time recovery, external monitoring, secret management, and
  manager MFA remain production deployment gates.
- Schedule A and Schedule B are alternating Monday-through-Saturday weeks
  derived from a stable Monday anchor. Weekly work appears in both schedules;
  biweekly work stays on its calculated A or B week.
- Three-week, monthly date, and nth-weekday services remain in Others with a
  calculated next service date. Saturday due dates move to Friday and Sunday
  due dates move to Monday. Placing a visit keeps it out of Others until its
  service date passes, then the next occurrence becomes available.
- Weekly work remains assigned in both A/B schedules and biweekly work remains
  on its alternating week. Flexible visits appear on their calculated A/B day
  before placement and can only use an open crew/time block.
- The four operational start blocks are 8:00 AM, 10:30 AM, 1:00 PM, and
  3:00 PM. Managers may move upcoming work between active crews and blocks;
  completed and in-progress work remains immutable history.
- Sunday recurrence due dates remain recorded as Sunday, but their service
  defaults to Saturday because operating schedules run Monday through Saturday.
- Payroll periods snapshot active employees when generated. Managers enter each
  employee's first check-in and final check-out for Monday through Friday; the
  system calculates hours, overtime, tips, and the configured captain amount.
- Captain pay uses the employee's active captain assignment when payroll is
  prepared, allowing the prior two weeks to be entered after a captain is set up.
- A declined daily payment remains an outstanding customer balance. The Credits
  view displays it for follow-up but does not create a positive accounting credit.
- Financial reports recognize revenue when a payment is collected, calculate
  collection rate from charges settled for the selected period, and separate
  wages from recorded operating expenses.
- Operational lists use 50-record pages with database-backed prefix search and
  indexed search fields. Records have no total-count cap; additional pages remain
  available as the business grows.
- Deleting a property archives it instead of removing its database row so prior
  bookings, payments, and reports keep their historical references.
- Cancelling a customer ends active or paused recurring plans, cancels future
  unstarted bookings and queued reminders, and removes those visits from crew
  routes. Completed services, charges, balances, and reports remain intact.
- Cancelling one visit leaves its customer and recurring plan active. The visit
  is removed from its route, its queued reminder is cancelled, and a manager may
  apply the configured late-cancellation fee to the customer ledger.
- Individual-date services use a finite, validated list of calendar dates in
  the existing recurring-service record. Moving one visit preserves the series;
  moving future visits re-anchors the recurrence and eligible bookings in one
  transaction.
- Browser workflow tests always use a disposable in-memory database with
  manager, captain, and cleaner accounts. Production records are never copied
  into automated test runs.
- New and reset accounts must replace their temporary password before any
  business endpoint is available. Completing that change revokes the temporary
  credential and clears the requirement.
- Service tips are stored once per booking, split deterministically across the
  assigned cleaners, and included automatically in open payroll periods.
  Manager-entered payroll tips remain separate employee-specific adjustments.
- Incorrect payments, unpaid charges, and expenses are corrected through
  reversal, waiver, and void records rather than deleting financial history.
- Every release runs both clean-install migration tests and a PostgreSQL upgrade
  from migration 012 with existing operational and financial records.
- Recording payment from a declined service targets that exact charge. Partial
  payments leave the remaining amount outstanding; excess money becomes a
  customer credit instead of silently paying a different charge.
- Editing a service plan updates the plan definition and eligible requested,
  confirmed, or assigned future visits. Started and historical visits remain
  unchanged.
- Browser workday defaults use the Queen City Maid `America/New_York` timezone
  instead of the manager device timezone, keeping routes, ledgers, and seeded
  service dates aligned when UTC crosses midnight first.

## Verification

- Foundation database migration test: passing.
- Auth/API foundation tests: passing.
- Operations schema tests: passing.
- Lead deadline, recurrence, tip, and payroll domain tests: passing.
- Customer/property/employee/team/service resource tests: passing.
- Lead, quote, recurrence, and booking API tests: passing.
- Dispatch, cleaner route, time tracking, and issue tests: passing.
- Charges, payments, credits, tips, corrections, and payroll tests: passing.
- Consent, notification queue, dashboard, reports, settings, and account tests: passing.
- Spreadsheet onboarding import and security hardening tests: passing.
- Dependency audit: 0 vulnerabilities.
- Production React build: passing.
- Desktop manager workflow browser verification: passing.
- Mobile manager and captain workflow browser verification: passing.
- Browser console and horizontal-overflow checks: passing.
- Persistent PostgreSQL migration, seed, login, application restart, record
  survival, public tunnel health, and local backup: passing.
- PostgreSQL checksums, least-privilege runtime role, secure cookie and origin
  controls, persistent login throttling, scheduled backup, checksum, disposable
  restore drill, and consolidated security status: passing.
- Customer frequency and payment preference create, update, import, validation,
  persistence, desktop, and mobile checks: passing.
- Alternating A/B generation, recurrence idempotency, Sunday adjustment,
  flexible-service placement, crew/time moves, unavailable-crew rejection,
  past-service immutability, history, manager permissions, and organization
  isolation tests: passing.
- Schedule A/B, Monday-Saturday, crew tabs, fixed time blocks, recurring and
  one-time booking forms, Others, Past Services, and responsive browser checks:
  passing.
- Two-week payroll generation, active employee snapshots, Monday-Friday hour
  entry and editing, tips, overtime, captain day pay, approval locks, summary
  exports, payroll history, responsive UI, and live public workflow: passing.
- Managed Render web service and PostgreSQL deployment, clean manager bootstrap,
  temporary-secret cleanup, permanent HTTPS smoke checks, and database health:
  passing.
- Standard service initialization, stale-request rejection, and immediate
  customer/property save visibility with fake-data browser verification: passing.
- Manual-state stale-request rejection, expanded operational list limits,
  request timeouts, page error recovery, and atomic mutation/audit transactions:
  passing.
- Daily schedule ledger, flat and hourly payment decisions, immutable approved
  receipts, outstanding balances, account credits, customer standing, expenses,
  payroll/month/year reports, retention, period comparisons, dashboard metrics,
  manager permissions, organization isolation, desktop/mobile layout, live
  migration, public health, and verified post-migration backup: passing.
- Server-side lead, customer, property, and employee search and pagination,
  1,020-customer scale coverage, archived property removal, searchable schedule
  selectors, and scheduled-service editing browser verification: passing.
- Individual recurring-booking service-type changes preserve the future
  recurring plan and pass reference, permission, and regression tests.
- Scoped recurring-service edits update the plan and eligible future visits in
  one transaction while preserving completed and otherwise closed history.
- Flexible recurrence dates, manager-set next dates, weekday adjustment,
  open-slot conflict protection, post-service rollover, last servicing crew,
  customer frequency synchronization, and cross-module schedule reads pass
  regression tests.
- Customer cancellation status, reason, recurring-plan shutdown, future-booking
  cancellation, idempotency, manager permissions, organization isolation, and
  historical-record preservation pass regression tests. Full suite: 59 passing
  tests.
- Single-visit cancellation with and without a fee, route and reminder cleanup,
  recurring-plan preservation, duplicate protection, manager permissions, and
  organization isolation pass regression tests. Full suite: 60 passing tests;
  production build: passing.
- Individual multi-date creation, flexible-schedule advancement, single-visit
  moves, recurring future moves, crew conflicts, customer frequency updates,
  and atomic rollback pass regression tests. Full server suite: 63 passing.
- Playwright verifies manager/captain/cleaner sign-in and permissions, all
  manager navigation, session refresh and sign-out, mobile navigation without
  horizontal overflow, and the full multi-date create/place/edit workflow.
  Browser suite: 5 passing; production build: passing.
- Complete API regression suite: 68 passing tests.
- Real PostgreSQL 18 previous-release upgrade through migration 013: passing
  with users, bookings, charges, payments, expenses, and tips preserved.
- Complete Playwright workflow suite: 23 passing tests across manager, captain,
  cleaner, desktop, and 390px mobile projects.
- Filtered full-record CSV exports, lead ownership and lifecycle, quote
  revisions and decisions, customer and property lifecycle, employee/team/
  account deactivation and reactivation, schedule duplication/unassignment/
  restoration, recurring-plan controls, payment correction, charge waiver,
  service tips, message retry, expense correction, imports, and audit history:
  passing in the browser suite.
- Production dependency audit at high severity: 0 known vulnerabilities.
- Render logical database export created before migration 013; the managed
  database also retained its three-day point-in-time recovery window.
- GitHub CI run 11 passed the API, PostgreSQL upgrade, production build, and
  Playwright gates for commit `46ea5fe`.
- Render pre-deploy environment validation and migration 013 completed, the
  internal health check passed, and commit `46ea5fe` became live.
- External HTTPS health, cache-control, server-signature, application-shell,
  live sign-in-screen, and browser-console smoke checks: passing.
- Admin automations queue the next two schedule weeks and optional
  consent-checked service and balance reminders. Daily claim, duplicate,
  failed-run retry, provider-state, manager permission, organization isolation,
  and manual-run tests pass.
- The dashboard Action Center returns named overdue leads, unassigned visits,
  unresolved issues, failed messages, availability requests, and customer
  balances without cross-organization exposure.
- Complete API regression suite: 72 passing tests. Complete Playwright workflow
  suite: 24 passing tests, including persisted automation settings and manual
  run history at desktop and mobile widths.
- Real PostgreSQL 18 previous-release upgrade through migration 014: passing
  with prior accounts and financial records preserved and outbound reminder
  automation disabled by default.
- GitHub CI run 13 passed for commit `008348a`; Render completed migration 014,
  passed its internal health check, and made the release live.
- External production smoke and live browser-console checks pass at
  `https://queen-city-maid-operations.onrender.com`.
- Selected past-due charges accept full or partial later payments without
  allocating another charge first; duplicate, permission, organization, credit,
  outstanding-balance, and audit cases pass. Full API suite: 75 passing tests.
- Active and paused service plans expose a complete edit form. Detail changes
  update eligible future visits, schedule changes release and regenerate future
  occurrences, and completed history remains immutable.
- Complete Playwright workflow suite: 24 passing tests, including declined
  payment collection, payment reversal/waiver separation, persisted plan edits,
  and the existing desktop/mobile role coverage.
- Real PostgreSQL previous-release upgrade and production build pass. Production
  dependency audit: 0 known vulnerabilities after updating PostCSS to 8.5.25.
- UTC-boundary simulation passes all 75 API tests and all 24 desktop/mobile
  browser workflows while using Queen City Maid's Charlotte workday.

## Definition of Done

A feature is `done` only when its happy path, validation failure, permission
boundary, organization isolation, and relevant business edge cases have passing
tests and the API documentation is current.
