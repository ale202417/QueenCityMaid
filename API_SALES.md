# Sales API

`createSalesRouter({ pool })` is exported from `src/server/sales.js`. Mount it
after the existing session authentication and manager role guard:

```js
app.use("/api", sessionAuth, requireRole("manager"), createSalesRouter({ pool }));
```

All routes return `{ "data": ... }`. Errors use the shared
`{ "error": { "code", "message", "details"? } }` shape. Request bodies and
query strings reject unknown fields. Every record and foreign reference is
restricted to `req.auth.organizationId`.

## Leads

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/leads` | List leads; filters: `q`, `status`, `ownerUserId`, `limit`, `offset`; includes pagination metadata |
| `POST` | `/leads` | Intake a lead and calculate its response deadline |
| `GET` | `/leads/:id` | Get a lead and its activity history |
| `PATCH` | `/leads/:id` | Update ownership, contact details, status, or follow-up fields |
| `POST` | `/leads/:id/close` | Close the lead with an outcome and reason |
| `POST` | `/leads/:id/reopen` | Return a closed lead to active follow-up |
| `POST` | `/leads/:id/convert` | Atomically create an active customer and optional first property |
| `POST` | `/leads/:id/activities` | Record a note, call, text, email, status change, or follow-up |

Lead intake accepts `source`, `name`, one of `phone`/`email`, and optional
`ownerUserId`, `customerId`, `message`, and ISO `receivedAt`. Calls, texts, and
emails automatically record the first response and move a new lead to
`contacted`. A follow-up activity records completion. Updates may include
`expectedUpdatedAt`; a stale timestamp is rejected instead of overwriting a
newer manager change.

## Quotes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/quotes` | List quotes; filters: `status`, `customerId`, `limit`, `offset` |
| `POST` | `/quotes` | Create a draft quote with optional line items |
| `GET` | `/quotes/:id` | Get a quote, items, and decision history |
| `PATCH` | `/quotes/:id` | Update draft/reviewable quote details |
| `POST` | `/quotes/:id/items` | Add a line item |
| `PATCH` | `/quotes/:quoteId/items/:itemId` | Update a line item |
| `DELETE` | `/quotes/:quoteId/items/:itemId` | Remove a line item |
| `POST` | `/quotes/:id/send` | Mark a draft or changed quote sent |
| `POST` | `/quotes/:id/approve` | Record the customer's approving reply |
| `POST` | `/quotes/:id/decline` | Record the customer's declining reply |

Quote pricing types are `flat`, `hourly_team`, and `inspection`.
`hourly_team` requires `hourlyRateCents` and `estimatedHours`. Items accept
`serviceTypeId`, `description`, `quantity`, `unitPriceCents`, and `sortOrder`.
Item totals and the quote subtotal are server-calculated. Editing a sent or
approved quote changes it to `needs_review` and clears the prior decision
timestamp; it must be sent and approved again.

Approval and decline bodies contain `replyText` and optional ISO
`receivedAt`. Only a `sent` quote can receive a decision.

## Recurring Services

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/recurring-services` | List services; filters: `status`, `customerId`, `limit`, `offset` |
| `POST` | `/recurring-services` | Create a recurring service |
| `GET` | `/recurring-services/:id` | Get a service and its next 12 dates |
| `PATCH` | `/recurring-services/:id` | Update or pause/restart/end a service |

Create fields are `customerId`, `propertyId`, `serviceTypeId`,
`expectedDurationMinutes`, `priceCents`, `startsOn`, and `recurrenceRule`.
Optional fields are `preferredTeamId`, `quoteId`, `preferredStartTime`,
`restartOn`, `status`, `billingType`, `billingRateCents`, and
`specialInstructions`. `billingType` is `flat` or `hourly`; hourly services
require `billingRateCents`.

Supported recurrence rules:

```json
{ "type": "weekly", "intervalWeeks": 1 }
{ "type": "weekly", "intervalWeeks": 2 }
{ "type": "weekly", "intervalWeeks": 3 }
{ "type": "monthly", "dayOfMonth": 15 }
{ "type": "nth_weekday", "weekday": 1, "occurrence": 2 }
{ "type": "dates", "dates": ["2026-08-03", "2026-08-17"] }
```

`weekday` uses `0` for Sunday through `6` for Saturday.

Creating or updating a recurring service keeps the customer's displayed
frequency synchronized. Updating `startsOn` re-anchors the next occurrence;
the flexible schedule reflects the new date immediately.

Editing service details updates requested, confirmed, and assigned future
visits while preserving started, completed, and otherwise historical work.
Changing the recurrence, first date, preferred start time, or preferred crew
cancels and detaches old future occurrences, releases their recurrence keys,
and lets the schedule planner generate replacement visits from the edited plan.
The update response includes `futureBookingsUpdated` and
`futureBookingsCancelled` counts.

## Bookings

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/bookings` | List bookings; filters: `status`, `customerId`, ISO `from`, ISO `to`, `limit`, `offset` |
| `POST` | `/bookings` | Create a one-time or recurring booking occurrence |
| `GET` | `/bookings/:id` | Get a booking |
| `PATCH` | `/bookings/:id` | Update schedule, status, pricing, timing, or cancellation fields |

Required create fields are `customerId`, `propertyId`, `serviceTypeId`,
`scheduledStart`, `expectedDurationMinutes`, and `priceCents`. Optional links
(`quoteId`, `recurringServiceId`, and `previousBookingId`) must belong to the
same organization, customer, and property. Time-window end must follow its
start. Waived cancellation fees require `cancellationWaiverReason`.
Bookings may also include `billingType` and `billingRateCents`; hourly
bookings require a rate.

Booking updates may include `updateScope`. The default `single` updates only
the selected booking. `future` requires a recurring booking and applies its
service date, service type, duration, pricing, billing, and instructions to the
recurring plan plus requested, confirmed, or assigned visits from that date
forward.
Started, completed, cancelled, rescheduled, and unable-to-complete bookings
remain unchanged.

All creates, updates, quote sends/decisions, and nested writes are audited.
Writes involving multiple records run in a database transaction.
