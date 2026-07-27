import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import express from "express";
import { requireRole } from "../src/server/auth.js";
import { errorHandler, notFound } from "../src/server/http.js";
import { createSalesRouter } from "../src/server/sales.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

async function fixture(role = "manager") {
  const pool = await testPool();
  const ids = Object.fromEntries([
    "organizationA", "organizationB", "managerA", "managerB", "customerA", "customerB",
    "propertyA", "propertyB", "serviceA", "serviceB", "teamA"
  ].map(key => [key, crypto.randomUUID()]));

  await pool.query(
    `INSERT INTO organizations (id, name)
     VALUES ($1, 'Queen City Maid'), ($2, 'Other Cleaner')`,
    [ids.organizationA, ids.organizationB]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES
       ($1, $2, 'manager@qcm.test', 'Manager A', 'manager', 'x'),
       ($3, $4, 'manager@other.test', 'Manager B', 'manager', 'x')`,
    [ids.managerA, ids.organizationA, ids.managerB, ids.organizationB]
  );
  await pool.query(
    `INSERT INTO business_settings (organization_id, response_target_minutes)
     VALUES ($1, 60), ($2, 60)`,
    [ids.organizationA, ids.organizationB]
  );
  await pool.query(
    `INSERT INTO customers (id, organization_id, type, name, phone)
     VALUES
       ($1, $2, 'residential', 'Alice Client', '7045550101'),
       ($3, $4, 'residential', 'Other Client', '7045550102')`,
    [ids.customerA, ids.organizationA, ids.customerB, ids.organizationB]
  );
  await pool.query(
    `INSERT INTO properties
     (id, organization_id, customer_id, address_line1, city, postal_code)
     VALUES
       ($1, $2, $3, '100 Tryon St', 'Charlotte', '28202'),
       ($4, $5, $6, '200 Trade St', 'Charlotte', '28202')`,
    [
      ids.propertyA, ids.organizationA, ids.customerA,
      ids.propertyB, ids.organizationB, ids.customerB
    ]
  );
  await pool.query(
    `INSERT INTO service_types (id, organization_id, name, category)
     VALUES
       ($1, $2, 'Regular Cleaning', 'residential'),
       ($3, $4, 'Other Cleaning', 'residential')`,
    [ids.serviceA, ids.organizationA, ids.serviceB, ids.organizationB]
  );
  await pool.query(
    "INSERT INTO teams (id, organization_id, name) VALUES ($1, $2, 'Team One')",
    [ids.teamA, ids.organizationA]
  );

  const auth = {
    id: ids.managerA,
    organizationId: ids.organizationA,
    role
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = auth;
    next();
  });
  app.use("/api", requireRole("manager"), createSalesRouter({ pool }));
  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  cleanups.push(
    () => new Promise(resolve => server.close(resolve)),
    () => pool.end()
  );
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { body, ...options } = {}) {
    const headers = { ...(options.headers || {}) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, body: await response.json() };
  }

  return { pool, ids, request };
}

describe("sales API", () => {
  it("runs the lead, quote, recurring-service, and booking happy paths", async () => {
    const { pool, ids, request } = await fixture();

    const leadCreated = await request("/api/leads", {
      method: "POST",
      body: {
        source: "Nextdoor",
        name: "Alice Client",
        phone: "7045550101",
        message: "Needs a deep cleaning",
        receivedAt: "2026-07-24T22:30:00.000Z"
      }
    });
    assert.equal(leadCreated.response.status, 201);
    assert.equal(leadCreated.body.data.lead.status, "new");
    assert.ok(new Date(leadCreated.body.data.lead.responseDueAt) > new Date("2026-07-24T22:30:00Z"));
    const leadId = leadCreated.body.data.lead.id;

    const activity = await request(`/api/leads/${leadId}/activities`, {
      method: "POST",
      body: { type: "text", body: "Thanks, we can help." }
    });
    assert.equal(activity.response.status, 201);
    const leadDetail = await request(`/api/leads/${leadId}`);
    assert.equal(leadDetail.response.status, 200);
    assert.equal(leadDetail.body.data.lead.status, "contacted");
    assert.ok(leadDetail.body.data.lead.firstRespondedAt);
    assert.equal(leadDetail.body.data.activities.length, 1);
    const leadUpdated = await request(`/api/leads/${leadId}`, {
      method: "PATCH",
      body: {
        status: "awaiting_information",
        followUpDueAt: "2026-07-27T14:00:00.000Z"
      }
    });
    assert.equal(leadUpdated.response.status, 200);
    assert.equal(leadUpdated.body.data.lead.status, "awaiting_information");
    const leads = await request("/api/leads?status=awaiting_information");
    assert.equal(leads.response.status, 200);
    assert.equal(leads.body.data.leads.length, 1);
    assert.equal(leads.body.data.pagination.total, 1);
    const searchedLeads = await request("/api/leads?q=Alice");
    assert.equal(searchedLeads.body.data.leads[0].id, leadId);

    const quoteCreated = await request("/api/quotes", {
      method: "POST",
      body: {
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        pricingType: "flat",
        notes: "Customer approved text communication",
        items: [{
          serviceTypeId: ids.serviceA,
          description: "Deep cleaning",
          quantity: 1,
          unitPriceCents: 25000,
          sortOrder: 0
        }]
      }
    });
    assert.equal(quoteCreated.response.status, 201);
    assert.equal(quoteCreated.body.data.quote.subtotalCents, 25000);
    assert.equal(quoteCreated.body.data.items.length, 1);
    const quoteId = quoteCreated.body.data.quote.id;
    const itemId = quoteCreated.body.data.items[0].id;

    const extraItem = await request(`/api/quotes/${quoteId}/items`, {
      method: "POST",
      body: { description: "Patio", quantity: 1, unitPriceCents: 5000, sortOrder: 1 }
    });
    assert.equal(extraItem.response.status, 201);
    const removedItem = await request(
      `/api/quotes/${quoteId}/items/${extraItem.body.data.item.id}`,
      { method: "DELETE" }
    );
    assert.equal(removedItem.response.status, 200);
    const quoteUpdated = await request(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      body: { notes: "Customer confirmed the property condition." }
    });
    assert.equal(quoteUpdated.response.status, 200);

    const sent = await request(`/api/quotes/${quoteId}/send`, {
      method: "POST",
      body: {}
    });
    assert.equal(sent.response.status, 200);
    assert.equal(sent.body.data.quote.status, "sent");

    const approved = await request(`/api/quotes/${quoteId}/approve`, {
      method: "POST",
      body: { replyText: "Yes, that price works for me." }
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.data.quote.status, "approved");
    assert.equal(approved.body.data.approval.approved, true);

    const changedItem = await request(`/api/quotes/${quoteId}/items/${itemId}`, {
      method: "PATCH",
      body: { unitPriceCents: 27500 }
    });
    assert.equal(changedItem.response.status, 200);
    const revisedQuote = await request(`/api/quotes/${quoteId}`);
    assert.equal(revisedQuote.body.data.quote.status, "needs_review");
    assert.equal(revisedQuote.body.data.quote.subtotalCents, 27500);
    const resent = await request(`/api/quotes/${quoteId}/send`, {
      method: "POST",
      body: {}
    });
    assert.equal(resent.response.status, 200);
    const declined = await request(`/api/quotes/${quoteId}/decline`, {
      method: "POST",
      body: { replyText: "No thank you after the price change." }
    });
    assert.equal(declined.response.status, 200);
    assert.equal(declined.body.data.quote.status, "declined");
    assert.equal(declined.body.data.approval.approved, false);
    const quotes = await request("/api/quotes?status=declined");
    assert.equal(quotes.response.status, 200);
    assert.equal(quotes.body.data.quotes.length, 1);

    const recurringCreated = await request("/api/recurring-services", {
      method: "POST",
      body: {
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        serviceTypeId: ids.serviceA,
        preferredTeamId: ids.teamA,
        recurrenceRule: { type: "weekly", intervalWeeks: 2 },
        preferredStartTime: "08:00",
        expectedDurationMinutes: 180,
        priceCents: 18000,
        startsOn: "2026-08-03"
      }
    });
    assert.equal(recurringCreated.response.status, 201);
    assert.deepEqual(
      recurringCreated.body.data.nextDates.slice(0, 3),
      ["2026-08-03", "2026-08-17", "2026-08-31"]
    );
    const recurringId = recurringCreated.body.data.recurringService.id;
    const recurringDetail = await request(`/api/recurring-services/${recurringId}`);
    assert.equal(recurringDetail.response.status, 200);
    const recurringPaused = await request(`/api/recurring-services/${recurringId}`, {
      method: "PATCH",
      body: { status: "paused", restartOn: "2026-09-01" }
    });
    assert.equal(recurringPaused.response.status, 200);
    assert.equal(recurringPaused.body.data.recurringService.status, "paused");
    const recurringListed = await request("/api/recurring-services?status=paused");
    assert.equal(recurringListed.response.status, 200);
    assert.equal(recurringListed.body.data.recurringServices.length, 1);

    const bookingCreated = await request("/api/bookings", {
      method: "POST",
      body: {
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        serviceTypeId: ids.serviceA,
        recurringServiceId: recurringId,
        status: "confirmed",
        scheduledStart: "2026-08-03T12:00:00.000Z",
        expectedDurationMinutes: 180,
        priceCents: 18000,
        specialRequests: "Call at the gate"
      }
    });
    assert.equal(bookingCreated.response.status, 201);
    assert.equal(bookingCreated.body.data.booking.status, "confirmed");
    const bookingId = bookingCreated.body.data.booking.id;
    const bookingDetail = await request(`/api/bookings/${bookingId}`);
    assert.equal(bookingDetail.response.status, 200);
    const bookingEdited = await request(`/api/bookings/${bookingId}`, {
      method: "PATCH",
      body: {
        serviceTypeId: ids.serviceA,
        expectedDurationMinutes: 210,
        priceCents: 20500,
        billingType: "flat",
        billingRateCents: null,
        specialRequests: "Use the side entrance"
      }
    });
    assert.equal(bookingEdited.response.status, 200);
    assert.equal(bookingEdited.body.data.booking.expectedDurationMinutes, 210);
    assert.equal(bookingEdited.body.data.booking.specialRequests, "Use the side entrance");
    const bookingCompleted = await request(`/api/bookings/${bookingId}`, {
      method: "PATCH",
      body: { status: "completed", actualDurationMinutes: 175 }
    });
    assert.equal(bookingCompleted.response.status, 200);
    assert.ok(bookingCompleted.body.data.booking.completedAt);

    const bookings = await request("/api/bookings?status=completed");
    assert.equal(bookings.response.status, 200);
    assert.equal(bookings.body.data.bookings.length, 1);

    const audits = await pool.query(
      "SELECT action FROM audit_events WHERE organization_id = $1",
      [ids.organizationA]
    );
    assert.ok(audits.rows.some(event => event.action === "approved"));
    assert.ok(audits.rows.some(event => event.action === "create"));
  });

  it("rejects invalid payloads and invalid state transitions", async () => {
    const { ids, request } = await fixture();

    const invalidLead = await request("/api/leads", {
      method: "POST",
      body: { source: "Website", name: "No Contact" }
    });
    assert.equal(invalidLead.response.status, 400);
    assert.equal(invalidLead.body.error.code, "validation_error");

    const invalidQuote = await request("/api/quotes", {
      method: "POST",
      body: {
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        pricingType: "hourly_team"
      }
    });
    assert.equal(invalidQuote.response.status, 400);
    assert.equal(invalidQuote.body.error.code, "validation_error");

    const invalidBooking = await request("/api/bookings", {
      method: "POST",
      body: {
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        serviceTypeId: ids.serviceA,
        scheduledStart: "2026-08-03T12:00:00.000Z",
        expectedDurationMinutes: 120,
        priceCents: 15000,
        customerTimeWindowStart: "2026-08-03T15:00:00.000Z",
        customerTimeWindowEnd: "2026-08-03T14:00:00.000Z"
      }
    });
    assert.equal(invalidBooking.response.status, 400);
    assert.equal(invalidBooking.body.error.code, "validation_error");
  });

  it("hides records and references from other organizations", async () => {
    const { pool, ids, request } = await fixture();
    const foreignLeadId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO leads
       (id, organization_id, owner_user_id, source, name, phone, status,
        received_at, response_due_at)
       VALUES ($1, $2, $3, 'Website', 'Foreign Lead', '7045550199', 'new', now(), now())`,
      [foreignLeadId, ids.organizationB, ids.managerB]
    );

    const hidden = await request(`/api/leads/${foreignLeadId}`);
    assert.equal(hidden.response.status, 404);
    assert.equal(hidden.body.error.code, "not_found");

    const foreignReference = await request("/api/quotes", {
      method: "POST",
      body: {
        customerId: ids.customerB,
        propertyId: ids.propertyB,
        pricingType: "flat",
        items: [{ description: "Should not work", unitPriceCents: 10000 }]
      }
    });
    assert.equal(foreignReference.response.status, 404);
    assert.equal(foreignReference.body.error.code, "not_found");

    const listed = await request("/api/leads");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.leads.length, 0);
  });

  it("is manager-only when mounted behind the existing role guard", async () => {
    const { request } = await fixture("cleaner");
    const denied = await request("/api/leads");
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error.code, "forbidden");
  });
});
