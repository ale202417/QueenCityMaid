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
  calculated next service date. Placing one changes its next occurrence rather
  than changing the customer's long-term recurrence pattern.
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

## Definition of Done

A feature is `done` only when its happy path, validation failure, permission
boundary, organization isolation, and relevant business edge cases have passing
tests and the API documentation is current.
