# Finance API

All routes require an authenticated `manager` and are mounted below `/api`.
Responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "details"? } }`.
Money is always integer cents. Dates use `YYYY-MM-DD`; timestamps require an explicit offset.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/payments/daily?date=YYYY-MM-DD` | List that work day's scheduled services and payment decisions |
| `POST` | `/payments/daily/:bookingId/decision` | Approve a collected payment or mark the service unpaid |
| `GET` | `/payments/records` | Read approved payments, declined decisions, and true overpayment credits |
| `GET` | `/payments/overview` | Read each active customer's balance and financial standing |
| `GET` | `/customers/:customerId/ledger` | Charges, allocated payments, credits, and balances |
| `POST` | `/customers/:customerId/charges` | Add a service, additional-work, or cancellation charge |
| `POST` | `/customers/:customerId/payments` | Record a payment, allocate oldest charges first, credit any excess |
| `POST` | `/bookings/:bookingId/tips` | Record a tip and return its deterministic equal employee split |
| `POST` | `/time-entries/:id/corrections` | Correct time and preserve before/after history with a reason |
| `POST` | `/time-entries/:id/approve` | Approve submitted or corrected time |
| `GET` | `/payroll-periods` | List stored payroll periods by payroll weeks |
| `POST` | `/payroll-periods` | Generate a Monday-starting two-week payroll for all active employees |
| `GET` | `/payroll-periods/:id` | Read weekly employee lines and daily hour entries |
| `POST` | `/payroll-periods/:id/days` | Add or update one employee's daily clock range and tips |
| `DELETE` | `/payroll-periods/:id/days/:entryId` | Remove a daily entry and recalculate payroll |
| `POST` | `/payroll-periods/:id/approve` | Approve payroll currently in review |
| `POST` | `/payroll-periods/:id/exports` | Create the next immutable export version |

## Request Bodies

```json
POST /payments/daily/:bookingId/decision
{
  "decision": "approved",
  "paymentMethod": "zelle",
  "hourlyMinutes": 150
}
```

`hourlyMinutes` is required only for hourly services. The API multiplies the
client's stored hourly rate by the entered time. Flat-rate services use the
booking price. Approving creates and allocates the payment; declining leaves
the service charge unpaid. The application displays those unpaid services in
the Credits tab, but they remain receivables rather than positive customer
credits.

```json
POST /customers/:customerId/charges
{
  "bookingId": "optional UUID",
  "type": "service",
  "description": "July 20 regular cleaning",
  "amountCents": 18000,
  "chargedOn": "2026-07-20"
}
```

```json
POST /customers/:customerId/payments
{
  "method": "zelle",
  "amountCents": 20000,
  "paidAt": "2026-07-24T15:00:00-04:00",
  "reference": "optional"
}
```

```json
POST /bookings/:bookingId/tips
{ "amountCents": 2501, "source": "customer" }
```

```json
POST /time-entries/:id/corrections
{
  "checkInAt": "2026-07-20T08:00:00-04:00",
  "checkOutAt": "2026-07-20T17:00:00-04:00",
  "paidMinutes": 540,
  "reason": "Captain confirmed the departure time"
}
```

Approval and export requests use `{}`. Payroll generation uses:

```json
{ "startsOn": "2026-07-20" }
```

The start date must be Monday. Generation snapshots each active employee and
their hourly rate into Week 1 and Week 2. Managers then record Monday-through-
Friday hours:

```json
POST /payroll-periods/:id/days
{
  "employeeId": "UUID from the generated payroll",
  "workDate": "2026-07-20",
  "checkInTime": "08:00",
  "checkOutTime": "17:00",
  "tipsCents": 2500
}
```

The API calculates elapsed time, weekly overtime, wages, and one configured
captain payment for each entered workday on which the employee held an active
captain assignment. Updating the same employee and date replaces that daily
entry. Approved or exported periods cannot be edited.

## Export Shape

Each export returns `version`, `columns`, and one pay-period summary row for
every employee who recorded hours. The same payload is valid JSON and can be
converted to CSV by writing `columns` as the header and each `rows` item as a
record. Creating another export increments `version` and stores another
immutable snapshot.
