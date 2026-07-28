# Queen City Maid API

All endpoints return JSON. Successful responses use `{ "data": ... }`. Errors
use `{ "error": { "code": "...", "message": "...", "details": ... } }`.

Authentication uses the `qcm_session` database-backed cookie. It is `HttpOnly`,
`SameSite=Lax`, scoped to `/`, expires after seven days, and is `Secure` unless
`SESSION_COOKIE_SECURE=false` is set for local development.

## Endpoints

### `GET /api/health`

Checks API and database availability. No authentication required.

### `POST /api/auth/login`

Creates a session and records a login audit event.

```json
{
  "email": "manager@queencitymaid.local",
  "password": "your-password"
}
```

Returns the current user and organization. Accounts created or reset with a
temporary password also return `mustChangePassword: true`; every business API
route remains blocked until that password is replaced. Invalid credentials
return `401`; invalid or unknown request fields return `400`.

### `POST /api/auth/logout`

Requires authentication. Deletes the database session, clears the cookie, and
records a logout audit event.

### `GET /api/auth/me`

Requires a manager or cleaner session. Returns the current user, role, and
organization.

### `POST /api/auth/change-password`

Requires authentication. Accepts `currentPassword` and a distinct
`newPassword` of at least 12 characters. Other sessions for that user are
revoked and any temporary-password requirement is cleared.

### `GET /api/audit-events?limit=50`

Requires the `manager` role. Returns up to 100 newest audit events belonging
only to the signed-in manager's organization.

## Operational Resources

Except for `GET /api/employees/me`, all endpoints below require the `manager`
role and operate only on the signed-in manager's organization. Lists accept
`limit` (default 50, maximum 100) and `offset`. List responses include
`pagination.total`, `pagination.limit`, and `pagination.offset`; the total
number of records is not capped.

| Resource | List/Create | Detail/Update/Delete |
|---|---|---|
| Customers | `GET/POST /api/customers` | `GET/PATCH/DELETE /api/customers/:id` |
| Properties | `GET/POST /api/properties` | `GET/PATCH/DELETE /api/properties/:id` |
| Employees | `GET/POST /api/employees` | `GET/PATCH/DELETE /api/employees/:id` |
| Teams | `GET/POST /api/teams` | `GET/PATCH/DELETE /api/teams/:id` |
| Availability | `GET/POST /api/availability-exceptions` | `GET/PATCH/DELETE /api/availability-exceptions/:id` |
| Quality feedback | `GET/POST /api/quality-feedback` | `GET/PATCH/DELETE /api/quality-feedback/:id` |
| Service types | `GET/POST /api/service-types` | `GET/PATCH/DELETE /api/service-types/:id` |

Customer lists can filter by `type` and `status`; property and feedback lists
by `customerId` or `employeeId`; availability by `employeeId` and `status`;
service types by `category`; and resources with an `active` field by
`active=true|false`.

Customer, property, and employee lists also accept `q` for case-insensitive
prefix search across names and primary contact or address fields.

Customer records support optional `serviceFrequency` values of `weekly`,
`biweekly`, `monthly`, or `other`, and optional `paymentMethod` values of
`zelle`, `venmo`, `paypal`, `cash`, `check`, or `other`.

Deleting customers, properties, employees, teams, or service types archives
the record. Availability exceptions and quality feedback are permanently
deleted. Quality feedback changes automatically recalculate the employee's
average rating.

### Team membership

- `GET/POST /api/teams/:teamId/members`
- `GET/PATCH/DELETE /api/teams/:teamId/members/:employeeId/:effectiveFrom`

`effectiveFrom` uses `YYYY-MM-DD`. Captains must be employees marked as drivers.

### Cleaner profile

`GET /api/employees/me` requires the `cleaner` role and returns only the
employee record linked to the current user. Cleaner list and mutation access is
not exposed.

## Additional Modules

- Leads, quotes, recurring services, and bookings are documented in
  [API_SALES.md](API_SALES.md).
- Charges, payments, credits, tips, time corrections, and payroll are
  documented in [API_FINANCE.md](API_FINANCE.md).
- Dashboard metrics, expenses, financial reports, and comparison analytics are
  documented in [API_REPORTING.md](API_REPORTING.md).
- Payroll periods are selected by their two-week date range in the application;
  internal record IDs are used only in API paths.
- `GET /api/dashboard` returns live operational counts and named action-center
  records for overdue leads, unassigned services, unresolved job issues, failed
  messages, availability requests, and customer balances.
- `GET /api/reports/operations?from=YYYY-MM-DD&to=YYYY-MM-DD` returns booking,
  finance, and labor summaries.
- `GET/PATCH /api/settings` reads or updates organization business rules.
- Account administration is available at `GET/POST/PATCH /api/users`; password
  resets use `POST /api/users/:id/reset-password`.
- `POST /api/imports/customers` and `POST /api/imports/employees` accept
  validated spreadsheet row arrays and update matches by phone number.
- `POST /api/customers/:id/text-consent` records explicit consent or revocation.
- `POST /api/customers/:id/cancel` accepts an optional `reason`, marks the
  customer cancelled, ends active or paused recurring services, cancels future
  unstarted bookings and queued reminders, and preserves prior operational and
  financial history. Repeated requests are safe.
- `POST /api/customers/:id/reactivate`, `/pause`, and `/resume` provide
  reversible customer lifecycle controls while retaining historical records.
- Booking and payment reminders are queued at
  `/api/bookings/:id/reminder` and `/api/customers/:id/payment-reminder`.
- `POST /api/customers/:id/messages` composes a consent-checked customer text.
- `GET /api/notifications` lists delivery state, while
  `POST /api/notifications/:id/cancel` and
  `POST /api/notifications/:id/retry` control queued or failed delivery.
- `GET /api/inbound-messages` lists received customer messages;
  `POST /api/notifications/send-due` runs an immediate delivery pass.
- `GET /api/automations` returns manager-only automation settings, SMS provider
  readiness, and the 20 most recent automation runs for the organization.
- `POST /api/automations/run` runs the enabled daily operations steps
  immediately and records the result. Scheduled and manual runs reuse booking
  and notification idempotency keys.

## Daily Automations

Organization settings control automatic Schedule A/B upkeep, consent-checked
day-before service reminders, consent-checked overdue balance reminders, the
balance reminder interval, and the daily run time. Customer-facing reminder
automations default off. Schedule upkeep defaults on.

The background worker claims one scheduled run per organization and local
calendar day. Failed or stale runs can be retried; completed runs cannot create
duplicate visits or messages. Managers can review every result and run the same
steps manually from Settings.

## Dispatch And Service Day

- `POST /api/schedule-planner/sync` safely creates missing weekly and biweekly
  booking occurrences for the current Schedule A/B cycle.
- `GET /api/schedule-planner?week=A|B&reference=YYYY-MM-DD` returns the
  Monday-through-Saturday crew board, four supported time blocks, and flexible
  visits due on each day but not yet assigned to a crew.
- `POST /api/schedule-planner/bookings/:id/move` moves an upcoming booking to
  another crew, service day, or time block. Started and completed work is
  immutable; unavailable crews and occupied crew/time blocks are rejected.
  Supplying no team unassigns the visit while keeping it scheduled.
- `POST /api/schedule-planner/bookings/:id/cancel` accepts an optional `reason`
  and `applyFee`. It cancels only that visit, removes route assignments, cancels
  queued reminders, optionally creates the configured late-cancellation ledger
  charge, and leaves the customer and recurring service active.
- `POST /api/schedule-planner/bookings/:id/restore` returns a cancelled visit
  to an available date, crew, and time block without rewriting its history.
- `GET /api/schedule-planner/others` calculates the next unplaced three-week,
  monthly-date, and nth-weekday occurrence and returns the last servicing crew.
  Flexible Saturday dates move to Friday and Sunday dates move to Monday.
- `POST /api/schedule-planner/others/:id/place` places one calculated
  occurrence on its calculated date in Schedule A or B. A placed occurrence
  stays hidden until its service date passes, when the next date rolls forward.
- `GET /api/schedule-planner/history?from=YYYY-MM-DD&to=YYYY-MM-DD` returns
  prior services with the assigned crew and employee names.
- `GET /api/dispatch?date=YYYY-MM-DD` lists the manager's bookings and current
  route assignment for one service date.
- `POST /api/routes` builds a draft route, assigns every active team member to
  its bookings, and rejects unavailable crews.
- `PATCH /api/routes/:id` records route duration, finish estimate, and any
  manager override.
- `POST /api/routes/:id/finalize` publishes a draft route.
- `GET /api/my-route?date=YYYY-MM-DD` returns the signed-in cleaner's ordered
  route with access notes, service requests, and reference checklist.
- `POST /api/routes/:id/check-in` and `POST /api/routes/:id/check-out` let the
  assigned captain record time for the full crew.
- `POST /api/bookings/:id/issues` records access, damage, safety, extra work,
  service, or other field issues. Cleaners can only report issues for assigned
  bookings.
- `PATCH /api/job-issues/:id` lets a manager resolve an issue and creates an
  additional-work charge only after customer approval is recorded.

Completing a route creates one unpaid service charge per booking when none
exists.

## Authorization

Unauthenticated requests return `401`. Authenticated users without an allowed
role return `403`. Organization-owned queries must use the organization ID from
the authenticated session, never an organization ID supplied by the client.

Unsafe browser requests with a foreign `Origin` return `403`. Login throttling
is persisted in PostgreSQL so application restarts cannot clear failed-attempt
limits. API responses use `Cache-Control: no-store`.
