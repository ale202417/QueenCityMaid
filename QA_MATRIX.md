# Product QA Matrix

This matrix is the release checklist for Queen City Maid. Browser checks run
against disposable local data. Production data is never used for automated QA.

Status values: `todo`, `in_progress`, `done`.

| Area | Workflow and release expectation | API tests | Browser tests | Status |
| --- | --- | --- | --- | --- |
| Authentication | Valid and invalid sign-in, session refresh, sign-out | done | done | done |
| Permissions | Manager, captain, and cleaner see only allowed modules and actions | done | done | done |
| Navigation | Every desktop and mobile module opens without page, console, or request errors | n/a | done | done |
| Dashboard | Counts, financial totals, and named manager action records agree with source records | done | done | done |
| Automations | Schedule upkeep, consented reminders, daily claims, manual runs, recovery, and history | done | done | done |
| Leads | Create, edit, assign, follow up, quote, convert, close, and reopen | done | done | done |
| Customers | Create, edit, frequency/payment details, notes, cancel, pause, resume, and reactivate | done | done | done |
| Properties | Create, edit, delete with dependency protection, access details | done | done | done |
| Consent | Record and revoke text consent; block unconsented outbound text | done | done | done |
| Fixed schedules | View A/B weeks, add service, edit type/details, move crew/time, remove | done | done | done |
| Flexible schedules | Set next date, individual multi-date entry, advance recurrence, weekday adjustment, assign occurrence | done | done | done |
| Visit cancellation | Cancel one visit with optional fee and preserve recurring service | done | done | done |
| Customer cancellation | Cancel future work and reminders without deleting history | done | done | done |
| Schedule history | Past services retain dates, crew, status, and customer context | done | done | done |
| Employees | Create, edit, rates, quality feedback, availability, captain stipend eligibility, deactivate | done | done | done |
| Teams | Create, edit membership/captain, preserve effective history, deactivate | done | done | done |
| Dispatch | Build/finalize routes, order stops, publish to captain, and reassign coverage | done | done | done |
| Cleaner day | Captain and cleaner routes, instructions, check-in/out, issue reporting and resolution | done | done | done |
| Daily ledger | Scheduled clients appear; flat/hourly charges calculate correctly | done | done | done |
| Payments | Confirm, decline, reverse, remind, and preserve overpayment credit | done | done | done |
| Credits | Apply, adjust, waive, and preserve audit history | done | done | done |
| Tips | Record and edit one service tip; split it evenly among assigned cleaners | done | done | done |
| Payroll | Generate two weeks, add hours, tips, captain days, totals, history | done | done | done |
| Messages | Compose, consent checks, status, cancellation, failure, and retry handling | done | done | done |
| Reports | Payroll-period, month, year, expenses, retention, and comparison analytics | done | done | done |
| Settings | Business rules, service types, accounts, security, imports, and activity history | done | done | done |
| Imports | Validate preview, reject bad rows, import accepted rows once | done | done | done |
| Audit trail | Sensitive mutations identify actor, time, target, and before/after state | done | done | done |
| Persistence | Successful mutations remain correct after reload and a new session | done | done | done |
| Failure handling | Validation, conflict, failed delivery, and server errors stay recoverable | done | done | done |
| Responsive UI | Every manager module and field workflow works at desktop and 390px mobile width | n/a | done | done |
| Privacy | No cross-role or cross-organization data exposure in API or rendered UI | done | done | done |
| Migration safety | Clean install and PostgreSQL previous-release upgrade preserve data | done | n/a | done |
| Production smoke | Health, protected API headers, static app, sign-in screen, and console after deploy | done | done | done |

## Release Gates

1. All P0-P2 defects discovered by this matrix are fixed with regression tests.
2. API tests, production build, and Playwright tests pass in CI.
3. No unexpected browser console errors, page crashes, or HTTP 5xx responses.
4. Successful mutations persist after reload; failures never display a false save.
5. Manager-only actions are unavailable to captain and cleaner accounts.
6. Desktop and mobile core workflows have no clipped or overlapping controls.
7. Database migrations pass from both an empty database and the previous release.
8. A final production smoke test passes after deployment.

## Admin Controls Backlog

Controls are implemented after the matching workflow passes its audit. Each
mutation must be reversible where practical, permission checked, confirmed when
destructive, and recorded in history.

| Priority | Control | Status |
| --- | --- | --- |
| P1 | Reactivate cancelled customer | done |
| P1 | Pause and resume recurring service | done |
| P1 | Restore or reschedule a cancelled visit | done |
| P1 | Unassign a visit from a crew without deleting it | done |
| P1 | Deactivate and reactivate employee, team, or account | done |
| P2 | Duplicate a one-time booking | done |
| P2 | Waive or remove an unpaid cancellation fee | done |
| P2 | Reverse an incorrectly confirmed payment | done |
| P2 | Retry a failed message or reminder | done |
| P2 | Convert, close, and reopen a lead | done |
| P2 | Export currently filtered operational records | done |
| P2 | View record-level audit history | done |
