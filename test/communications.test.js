import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { afterEach, describe, it } from "node:test";
import {
  createCommunicationRouter,
  sendDueNotifications
} from "../src/server/communications.js";
import { errorHandler } from "../src/server/http.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture() {
  const pool = await testPool();
  const ids = Object.fromEntries(
    ["organization", "manager", "customer", "property", "service", "booking"]
      .map((key) => [key, crypto.randomUUID()])
  );
  await pool.query("INSERT INTO organizations (id, name) VALUES ($1, 'Queen City Maid')", [ids.organization]);
  await pool.query(
    `INSERT INTO users (id, organization_id, email, name, role, password_hash)
     VALUES ($1, $2, 'manager@test.local', 'Manager', 'manager', 'hash')`,
    [ids.manager, ids.organization]
  );
  await pool.query(
    `INSERT INTO customers (id, organization_id, type, name, phone)
     VALUES ($1, $2, 'residential', 'Jordan Ellis', '7045552000')`,
    [ids.customer, ids.organization]
  );
  await pool.query(
    `INSERT INTO properties
     (id, organization_id, customer_id, address_line1, city, postal_code)
     VALUES ($1, $2, $3, '1427 Queens Road', 'Charlotte', '28207')`,
    [ids.property, ids.organization, ids.customer]
  );
  await pool.query(
    `INSERT INTO service_types (id, organization_id, name, category)
     VALUES ($1, $2, 'Regular Cleaning', 'residential')`,
    [ids.service, ids.organization]
  );
  await pool.query(
    `INSERT INTO bookings
     (id, organization_id, customer_id, property_id, service_type_id, status,
      scheduled_start, expected_duration_minutes, price_cents)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', '2026-07-27T13:00:00Z', 180, 22000)`,
    [ids.booking, ids.organization, ids.customer, ids.property, ids.service]
  );
  const sent = [];
  const sender = {
    configured: true,
    async send(message) { sent.push(message); }
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { id: ids.manager, organizationId: ids.organization, role: "manager" };
    next();
  });
  app.use("/api", createCommunicationRouter({ pool, sender }));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)), () => pool.end());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { "content-type": "application/json" }
    });
    return { response, body: await response.json() };
  };
  return { pool, ids, request, sent, sender };
}

describe("customer communications", () => {
  it("requires consent, queues one reminder, and sends due messages", async () => {
    const { pool, ids, request, sent } = await fixture();
    const denied = await request(`/api/bookings/${ids.booking}/reminder`, {
      method: "POST", body: "{}"
    });
    assert.equal(denied.response.status, 409);
    assert.equal(denied.body.error.code, "text_consent_required");

    const consent = await request(`/api/customers/${ids.customer}/text-consent`, {
      method: "POST",
      body: JSON.stringify({ status: "granted", source: "Customer text reply" })
    });
    assert.equal(consent.response.status, 201);

    const queued = await request(`/api/bookings/${ids.booking}/reminder`, {
      method: "POST",
      body: JSON.stringify({ dueAt: "2026-07-24T12:00:00.000Z" })
    });
    assert.equal(queued.response.status, 201);
    const queuedMessage = await pool.query(
      "SELECT body FROM notifications WHERE booking_id = $1 AND type = 'service_reminder'",
      [ids.booking]
    );
    assert.match(
      queuedMessage.rows[0].body,
      /Reply to this message if anything has changed\.$/
    );
    const duplicate = await request(`/api/bookings/${ids.booking}/reminder`, {
      method: "POST",
      body: JSON.stringify({ dueAt: "2026-07-24T12:00:00.000Z" })
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.body.data.notification.duplicate, true);

    const processed = await request("/api/notifications/send-due", {
      method: "POST", body: "{}"
    });
    assert.equal(processed.body.data.sent, 1);
    assert.equal(sent.length, 1);
  });

  it("queues a balance reminder and isolates notification lists", async () => {
    const { pool, ids, request } = await fixture();
    await pool.query(
      `INSERT INTO text_consents
       (id, organization_id, customer_id, phone, status, source, recorded_by)
       VALUES ($1, $2, $3, '7045552000', 'granted', 'reply', $4)`,
      [crypto.randomUUID(), ids.organization, ids.customer, ids.manager]
    );
    await pool.query(
      `INSERT INTO customer_charges
       (id, organization_id, customer_id, booking_id, type, description,
        amount_cents, status, charged_on)
       VALUES ($1, $2, $3, $4, 'service', 'Regular cleaning', 22000, 'unpaid', '2026-07-27')`,
      [crypto.randomUUID(), ids.organization, ids.customer, ids.booking]
    );
    const reminder = await request(`/api/customers/${ids.customer}/payment-reminder`, {
      method: "POST", body: "{}"
    });
    assert.equal(reminder.response.status, 201);
    const paymentMessage = await pool.query(
      "SELECT body FROM notifications WHERE customer_id = $1 AND type = 'payment_reminder'",
      [ids.customer]
    );
    assert.equal(
      paymentMessage.rows[0].body,
      "Queen City Maid payment reminder: A balance of $220.00 is due for 1 cleaning. You can pay by Zelle, Venmo, PayPal, cash, or check. Reply to this message with any questions."
    );

    const otherOrganization = crypto.randomUUID();
    await pool.query("INSERT INTO organizations (id, name) VALUES ($1, 'Other')", [otherOrganization]);
    await pool.query(
      `INSERT INTO notifications
       (id, organization_id, type, channel, destination, body, status, idempotency_key, due_at)
       VALUES ($1, $2, 'test', 'sms', '1', 'secret', 'queued', $3, now())`,
      [crypto.randomUUID(), otherOrganization, crypto.randomUUID()]
    );
    const listed = await request("/api/notifications");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.notifications.length, 1);
    assert.match(listed.body.data.notifications[0].body, /\$220\.00/);
  });

  it("records provider failures without crashing the queue", async () => {
    const { pool, ids } = await fixture();
    await pool.query(
      `INSERT INTO notifications
       (id, organization_id, type, channel, destination, body, status, idempotency_key, due_at)
       VALUES ($1, $2, 'test', 'sms', '1', 'hello', 'queued', $3, now())`,
      [crypto.randomUUID(), ids.organization, crypto.randomUUID()]
    );
    const result = await sendDueNotifications(pool, {
      async send() { throw new Error("provider down"); }
    });
    assert.equal(result[0].status, "failed");
    const notification = await pool.query(
      "SELECT status, failure_reason FROM notifications WHERE organization_id = $1",
      [ids.organization]
    );
    assert.equal(notification.rows[0].status, "failed");
    assert.match(notification.rows[0].failure_reason, /provider down/);
  });
});
