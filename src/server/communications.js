import crypto from "node:crypto";
import { Router, urlencoded } from "express";
import twilio from "twilio";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import { withTransaction } from "./db.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";

const uuid = z.string().uuid();
const consentSchema = z.object({
  status: z.enum(["granted", "revoked"]),
  source: z.string().trim().min(1).max(200)
}).strict();
const reminderSchema = z.object({
  dueAt: z.string().datetime().optional()
}).strict();
const directMessageSchema = z.object({
  body: z.string().trim().min(1).max(1600),
  dueAt: z.string().datetime().optional()
}).strict();
const listSchema = z.object({
  status: z.enum(["queued", "sent", "delivered", "failed", "cancelled"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
}).strict();
const inboundListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100)
}).strict();
const incomingMessageSchema = z.object({
  AccountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  MessageSid: z.string().regex(/^(SM|MM)[0-9a-fA-F]{32}$/),
  From: z.string().min(1).max(40),
  To: z.string().min(1).max(40),
  Body: z.string().max(1600).default(""),
  OptOutType: z.enum(["START", "STOP", "HELP"]).optional()
}).passthrough();
const statusCallbackSchema = z.object({
  AccountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  MessageSid: z.string().regex(/^(SM|MM)[0-9a-fA-F]{32}$/),
  MessageStatus: z.enum([
    "accepted", "scheduled", "queued", "sending", "sent", "failed",
    "delivered", "undelivered", "canceled", "receiving", "received", "read"
  ]),
  ErrorCode: z.string().max(20).optional()
}).passthrough();

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  throw new Error("Phone number must include 10 to 15 digits");
}

function reminderDueAt(scheduledStart) {
  return new Date(new Date(scheduledStart).getTime() - 24 * 60 * 60 * 1000);
}

async function consentedCustomer(pool, organizationId, customerId) {
  const result = await pool.query(
    `SELECT id, name, phone FROM customers
     WHERE id = $1 AND organization_id = $2`,
    [customerId, organizationId]
  );
  if (!result.rowCount) throw new HttpError(404, "not_found", "Customer not found");
  const consent = await pool.query(
    `SELECT status FROM text_consents
     WHERE customer_id = $1 AND organization_id = $2
     ORDER BY recorded_at DESC LIMIT 1`,
    [customerId, organizationId]
  );
  if (consent.rows[0]?.status !== "granted") {
    throw new HttpError(409, "text_consent_required", "Current text consent is required");
  }
  return result.rows[0];
}

export async function queueNotification(pool, values) {
  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO notifications
       (id, organization_id, customer_id, employee_id, booking_id, type, channel,
        destination, body, status, idempotency_key, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'sms', $7, $8, 'queued', $9, $10)`,
      [
        id, values.organizationId, values.customerId || null, values.employeeId || null,
        values.bookingId || null, values.type, values.destination, values.body,
        values.idempotencyKey, values.dueAt
      ]
    );
  } catch (error) {
    if (error.code === "23505") {
      const existing = await pool.query(
        `SELECT id, status, due_at AS "dueAt"
         FROM notifications WHERE idempotency_key = $1`,
        [values.idempotencyKey]
      );
      return { ...existing.rows[0], duplicate: true };
    }
    throw error;
  }
  return { id, status: "queued", dueAt: values.dueAt, duplicate: false };
}

function localDate(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function queueAutomatedServiceReminders(
  pool,
  organizationId,
  { now = new Date(), daysAhead = 14 } = {}
) {
  const organization = await pool.query(
    "SELECT name, timezone FROM organizations WHERE id = $1",
    [organizationId]
  );
  if (!organization.rowCount) {
    throw new HttpError(404, "not_found", "Organization not found");
  }
  const through = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const bookings = await pool.query(
    `SELECT b.id, b.customer_id AS "customerId", b.scheduled_start AS "scheduledStart",
            c.phone, p.address_line1 AS "addressLine1"
     FROM bookings b
     JOIN customers c
       ON c.id = b.customer_id AND c.organization_id = b.organization_id
     JOIN properties p
       ON p.id = b.property_id AND p.organization_id = b.organization_id
     WHERE b.organization_id = $1
       AND b.status IN ('confirmed', 'assigned')
       AND b.scheduled_start > $2 AND b.scheduled_start <= $3
     ORDER BY b.scheduled_start`,
    [organizationId, now, through]
  );
  const result = { queued: 0, existing: 0, skippedNoConsent: 0 };
  for (const booking of bookings.rows) {
    const consent = await pool.query(
      `SELECT status FROM text_consents
       WHERE organization_id = $1 AND customer_id = $2
       ORDER BY recorded_at DESC LIMIT 1`,
      [organizationId, booking.customerId]
    );
    if (consent.rows[0]?.status !== "granted") {
      result.skippedNoConsent += 1;
      continue;
    }
    const serviceTime = new Date(booking.scheduledStart);
    const notification = await queueNotification(pool, {
      organizationId,
      customerId: booking.customerId,
      bookingId: booking.id,
      type: "service_reminder",
      destination: booking.phone,
      body: `${organization.rows[0].name} reminder: your cleaning at ${booking.addressLine1} is scheduled for ${serviceTime.toLocaleString("en-US", { timeZone: organization.rows[0].timezone, dateStyle: "medium", timeStyle: "short" })}. Reply to this message if anything has changed.`,
      idempotencyKey: `booking-reminder:${booking.id}:${serviceTime.toISOString()}`,
      dueAt: reminderDueAt(serviceTime)
    });
    result[notification.duplicate ? "existing" : "queued"] += 1;
  }
  return result;
}

export async function queueAutomatedPaymentReminders(
  pool,
  organizationId,
  { now = new Date(), reminderDays = 7, timeZone = "America/New_York" } = {}
) {
  const customers = await pool.query(
    `SELECT c.id, c.phone,
            COALESCE(SUM(cc.amount_cents), 0)::integer AS "balanceCents",
            COUNT(cc.id)::integer AS "serviceCount",
            MIN(cc.charged_on) AS "oldestChargeDate"
     FROM customers c
     JOIN customer_charges cc
       ON cc.customer_id = c.id AND cc.organization_id = c.organization_id
     WHERE c.organization_id = $1 AND cc.status = 'unpaid'
     GROUP BY c.id, c.phone
     ORDER BY MIN(cc.charged_on)`,
    [organizationId]
  );
  const cutoff = new Date(now.getTime() - reminderDays * 24 * 60 * 60 * 1000);
  const runDate = localDate(now, timeZone);
  const organization = await pool.query(
    "SELECT name FROM organizations WHERE id = $1",
    [organizationId]
  );
  const result = {
    queued: 0,
    existing: 0,
    skippedNoConsent: 0,
    skippedNotDue: 0
  };
  for (const customer of customers.rows) {
    const oldestChargeDate = customer.oldestChargeDate instanceof Date
      ? customer.oldestChargeDate.toISOString().slice(0, 10)
      : String(customer.oldestChargeDate).slice(0, 10);
    const oldestCharge = new Date(`${oldestChargeDate}T00:00:00.000Z`);
    const latest = await pool.query(
      `SELECT created_at AS "createdAt"
       FROM notifications
       WHERE organization_id = $1 AND customer_id = $2
         AND type = 'payment_reminder'
         AND status <> 'cancelled'
       ORDER BY created_at DESC LIMIT 1`,
      [organizationId, customer.id]
    );
    if (oldestCharge > cutoff || (latest.rowCount && new Date(latest.rows[0].createdAt) > cutoff)) {
      result.skippedNotDue += 1;
      continue;
    }
    const consent = await pool.query(
      `SELECT status FROM text_consents
       WHERE organization_id = $1 AND customer_id = $2
       ORDER BY recorded_at DESC LIMIT 1`,
      [organizationId, customer.id]
    );
    if (consent.rows[0]?.status !== "granted") {
      result.skippedNoConsent += 1;
      continue;
    }
    const balanceCents = Number(customer.balanceCents);
    const serviceCount = Number(customer.serviceCount);
    const notification = await queueNotification(pool, {
      organizationId,
      customerId: customer.id,
      type: "payment_reminder",
      destination: customer.phone,
      body: `${organization.rows[0].name} payment reminder: A balance of $${(balanceCents / 100).toFixed(2)} is due for ${serviceCount} ${serviceCount === 1 ? "cleaning" : "cleanings"}. You can pay by Zelle, Venmo, PayPal, cash, or check. Reply to this message with any questions.`,
      idempotencyKey: `payment-reminder-auto:${customer.id}:${runDate}`,
      dueAt: now
    });
    result[notification.duplicate ? "existing" : "queued"] += 1;
  }
  return result;
}

export async function sendDueNotifications(pool, sender, now = new Date()) {
  const due = await pool.query(
    `SELECT id, destination, body
     FROM notifications
     WHERE status = 'queued' AND send_attempted_at IS NULL AND due_at <= $1
     ORDER BY due_at, created_at
     LIMIT 100`,
    [now]
  );
  const results = [];
  for (const notification of due.rows) {
    const claimed = await pool.query(
      `UPDATE notifications SET send_attempted_at = $2
       WHERE id = $1 AND status = 'queued' AND send_attempted_at IS NULL
       RETURNING id`,
      [notification.id, now]
    );
    if (!claimed.rowCount) continue;
    try {
      const providerMessage = await sender.send({
        to: notification.destination,
        body: notification.body,
        idempotencyKey: notification.id
      });
      await pool.query(
        `UPDATE notifications
         SET status = 'sent', sent_at = $2, provider_message_id = $3,
             provider_status = $4
         WHERE id = $1 AND status = 'queued'`,
        [
          notification.id,
          now,
          providerMessage?.providerMessageId || null,
          providerMessage?.providerStatus || "sent"
        ]
      );
      results.push({
        id: notification.id,
        status: "sent",
        providerMessageId: providerMessage?.providerMessageId || null
      });
    } catch (error) {
      await pool.query(
        `UPDATE notifications SET status = 'failed', failure_reason = $2
         WHERE id = $1 AND status = 'queued'`,
        [notification.id, String(error.message || error).slice(0, 1000)]
      );
      results.push({ id: notification.id, status: "failed" });
    }
  }
  return results;
}

export function createHttpSmsSender({
  url = process.env.SMS_WEBHOOK_URL,
  token = process.env.SMS_WEBHOOK_TOKEN
} = {}) {
  return {
    configured: Boolean(url && token),
    async send(message) {
      if (!url || !token) throw new Error("SMS provider is not configured");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(message)
      });
      if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
    }
  };
}

export function createTwilioSmsSender({
  accountSid = process.env.TWILIO_ACCOUNT_SID,
  authToken = process.env.TWILIO_AUTH_TOKEN,
  fromNumber = process.env.TWILIO_FROM_NUMBER,
  messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID,
  webhookBaseUrl = process.env.TWILIO_WEBHOOK_BASE_URL,
  client
} = {}) {
  const validAccount = /^AC[0-9a-fA-F]{32}$/.test(accountSid || "");
  const validService = !messagingServiceSid
    || /^MG[0-9a-fA-F]{32}$/.test(messagingServiceSid);
  let normalizedFrom = "";
  try {
    normalizedFrom = fromNumber ? normalizePhone(fromNumber) : "";
  } catch {
    normalizedFrom = "";
  }
  const configured = Boolean(
    validAccount && authToken && validService && (normalizedFrom || messagingServiceSid)
  );
  const twilioClient = client || (configured
    ? twilio(accountSid, authToken, { autoRetry: true, maxRetries: 3 })
    : null);

  return {
    configured,
    provider: "twilio",
    async send(message) {
      if (!configured) throw new Error("Twilio SMS provider is not fully configured");
      const payload = {
        to: normalizePhone(message.to),
        body: message.body,
        ...(messagingServiceSid
          ? { messagingServiceSid }
          : { from: normalizedFrom })
      };
      if (webhookBaseUrl) {
        payload.statusCallback =
          `${webhookBaseUrl.replace(/\/+$/, "")}/api/webhooks/twilio/status`;
      }
      const result = await twilioClient.messages.create(payload);
      return {
        providerMessageId: result.sid,
        providerStatus: result.status
      };
    }
  };
}

export function createSmsSender(options = {}) {
  const provider = options.provider || process.env.SMS_PROVIDER;
  if (provider === "twilio" || options.accountSid || process.env.TWILIO_ACCOUNT_SID) {
    return createTwilioSmsSender(options);
  }
  return createHttpSmsSender(options);
}

function webhookUrl(req, baseUrl) {
  if (baseUrl) return `${baseUrl.replace(/\/+$/, "")}${req.originalUrl}`;
  return `${req.protocol}://${req.get("host")}${req.originalUrl}`;
}

function emptyTwiml(res) {
  res.type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
}

async function findSingleOrganization(pool, organizationId) {
  if (organizationId) {
    const configured = await pool.query("SELECT id FROM organizations WHERE id = $1", [organizationId]);
    return configured.rows[0] || null;
  }
  const result = await pool.query("SELECT id FROM organizations ORDER BY created_at LIMIT 2");
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function findCustomerByPhone(pool, organizationId, phone) {
  const customers = await pool.query(
    "SELECT id, phone FROM customers WHERE organization_id = $1",
    [organizationId]
  );
  const normalized = normalizePhone(phone);
  return customers.rows.find((customer) => {
    try {
      return normalizePhone(customer.phone) === normalized;
    } catch {
      return false;
    }
  }) || null;
}

export function createTwilioWebhookRouter({
  pool,
  accountSid = process.env.TWILIO_ACCOUNT_SID,
  authToken = process.env.TWILIO_AUTH_TOKEN,
  fromNumber = process.env.TWILIO_FROM_NUMBER,
  webhookBaseUrl = process.env.TWILIO_WEBHOOK_BASE_URL,
  organizationId = process.env.TWILIO_ORGANIZATION_ID
} = {}) {
  const router = Router();
  router.use(urlencoded({ extended: false, limit: "100kb" }));
  router.use((req, res, next) => {
    if (!accountSid || !authToken || !fromNumber) {
      return next(new HttpError(503, "sms_not_configured", "Twilio webhooks are not configured"));
    }
    const signature = req.get("x-twilio-signature") || "";
    if (!twilio.validateRequest(authToken, signature, webhookUrl(req, webhookBaseUrl), req.body)) {
      return next(new HttpError(403, "invalid_twilio_signature", "Twilio signature is invalid"));
    }
    next();
  });

  router.post("/sms", asyncRoute(async (req, res) => {
    const input = validate(incomingMessageSchema, req.body);
    if (input.AccountSid !== accountSid || normalizePhone(input.To) !== normalizePhone(fromNumber)) {
      throw new HttpError(403, "invalid_twilio_account", "Twilio account or recipient is invalid");
    }
    const organization = await findSingleOrganization(pool, organizationId);
    if (!organization) {
      throw new HttpError(
        409,
        "sms_organization_required",
        "TWILIO_ORGANIZATION_ID is required when more than one organization exists"
      );
    }
    const customer = await findCustomerByPhone(pool, organization.id, input.From);
    const id = crypto.randomUUID();
    const inserted = await pool.query(
      `INSERT INTO inbound_messages
       (id, organization_id, customer_id, provider_message_id, from_phone, to_phone,
        body, opt_out_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider_message_id) DO NOTHING
       RETURNING id`,
      [
        id,
        organization.id,
        customer?.id || null,
        input.MessageSid,
        normalizePhone(input.From),
        normalizePhone(input.To),
        input.Body,
        input.OptOutType || null
      ]
    );
    if (inserted.rowCount && customer && ["START", "STOP"].includes(input.OptOutType)) {
      await pool.query(
        `INSERT INTO text_consents
         (id, organization_id, customer_id, phone, status, source)
         VALUES ($1, $2, $3, $4, $5, 'Twilio opt-out webhook')`,
        [
          crypto.randomUUID(),
          organization.id,
          customer.id,
          normalizePhone(input.From),
          input.OptOutType === "START" ? "granted" : "revoked"
        ]
      );
    }
    emptyTwiml(res);
  }));

  router.post("/status", asyncRoute(async (req, res) => {
    const input = validate(statusCallbackSchema, req.body);
    if (input.AccountSid !== accountSid) {
      throw new HttpError(403, "invalid_twilio_account", "Twilio account is invalid");
    }
    const failed = ["failed", "undelivered", "canceled"].includes(input.MessageStatus);
    const delivered = input.MessageStatus === "delivered";
    const status = failed ? "failed" : delivered ? "delivered" : "sent";
    await pool.query(
      `UPDATE notifications
       SET status = $2, provider_status = $3,
           delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
           failure_reason = CASE WHEN $2 = 'failed' THEN $4 ELSE failure_reason END
       WHERE provider_message_id = $1`,
      [
        input.MessageSid,
        status,
        input.MessageStatus,
        failed
          ? `Twilio reported ${input.MessageStatus}${input.ErrorCode ? ` (error ${input.ErrorCode})` : ""}`
          : null
      ]
    );
    res.status(204).end();
  }));

  return router;
}

export function createCommunicationRouter({ pool, sender = createSmsSender() }) {
  const router = Router();
  router.use(requireRole("manager"));

  router.post("/customers/:id/text-consent", asyncRoute(async (req, res) => {
    const customerId = validate(uuid, req.params.id);
    const input = validate(consentSchema, req.body);
    const id = crypto.randomUUID();
    await withTransaction(pool, async (client) => {
      const customer = await client.query(
        "SELECT id, phone FROM customers WHERE id = $1 AND organization_id = $2",
        [customerId, req.auth.organizationId]
      );
      if (!customer.rowCount) throw new HttpError(404, "not_found", "Customer not found");
      await client.query(
        `INSERT INTO text_consents
         (id, organization_id, customer_id, phone, status, source, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id, req.auth.organizationId, customerId, customer.rows[0].phone,
          input.status, input.source, req.auth.id
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "text_consent", entityId: id, action: input.status, after: input
      });
    });
    data(res, { consent: { id, customerId, ...input } }, 201);
  }));

  router.post("/bookings/:id/reminder", asyncRoute(async (req, res) => {
    const bookingId = validate(uuid, req.params.id);
    const input = validate(reminderSchema, req.body);
    const booking = await pool.query(
      `SELECT b.id, b.customer_id AS "customerId", b.scheduled_start AS "scheduledStart",
              p.address_line1 AS "addressLine1"
       FROM bookings b
       JOIN properties p ON p.id = b.property_id
       WHERE b.id = $1 AND b.organization_id = $2
         AND b.status NOT IN ('cancelled', 'rescheduled')`,
      [bookingId, req.auth.organizationId]
    );
    if (!booking.rowCount) throw new HttpError(404, "not_found", "Booking not found");
    const customer = await consentedCustomer(
      pool, req.auth.organizationId, booking.rows[0].customerId
    );
    const serviceTime = new Date(booking.rows[0].scheduledStart);
    const notification = await queueNotification(pool, {
      organizationId: req.auth.organizationId,
      customerId: customer.id,
      bookingId,
      type: "service_reminder",
      destination: customer.phone,
      body: `Queen City Maid reminder: your cleaning at ${booking.rows[0].addressLine1} is scheduled for ${serviceTime.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}. Reply to this message if anything has changed.`,
      idempotencyKey: `booking-reminder:${bookingId}:${serviceTime.toISOString()}`,
      dueAt: input.dueAt ? new Date(input.dueAt) : reminderDueAt(serviceTime)
    });
    data(res, { notification }, notification.duplicate ? 200 : 201);
  }));

  router.post("/customers/:id/payment-reminder", asyncRoute(async (req, res) => {
    const customerId = validate(uuid, req.params.id);
    const input = validate(reminderSchema, req.body);
    const customer = await consentedCustomer(pool, req.auth.organizationId, customerId);
    const ledger = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::integer AS "balanceCents",
              COUNT(*)::integer AS "serviceCount"
       FROM customer_charges
       WHERE customer_id = $1 AND organization_id = $2 AND status = 'unpaid'`,
      [customerId, req.auth.organizationId]
    );
    const balanceCents = Number(ledger.rows[0].balanceCents);
    if (!balanceCents) throw new HttpError(409, "no_balance_due", "Customer has no unpaid balance");
    const serviceCount = Number(ledger.rows[0].serviceCount);
    const period = new Date().toISOString().slice(0, 7);
    const notification = await queueNotification(pool, {
      organizationId: req.auth.organizationId,
      customerId,
      type: "payment_reminder",
      destination: customer.phone,
      body: `Queen City Maid payment reminder: A balance of $${(balanceCents / 100).toFixed(2)} is due for ${serviceCount} ${serviceCount === 1 ? "cleaning" : "cleanings"}. You can pay by Zelle, Venmo, PayPal, cash, or check. Reply to this message with any questions.`,
      idempotencyKey: `payment-reminder:${customerId}:${period}`,
      dueAt: input.dueAt ? new Date(input.dueAt) : new Date()
    });
    data(res, { notification }, notification.duplicate ? 200 : 201);
  }));

  router.post("/customers/:id/messages", asyncRoute(async (req, res) => {
    const customerId = validate(uuid, req.params.id);
    const input = validate(directMessageSchema, req.body);
    const dueAt = input.dueAt ? new Date(input.dueAt) : new Date();
    const notification = await withTransaction(pool, async (client) => {
      const customer = await consentedCustomer(
        client, req.auth.organizationId, customerId
      );
      const queued = await queueNotification(client, {
        organizationId: req.auth.organizationId,
        customerId,
        type: "manager_message",
        destination: customer.phone,
        body: input.body,
        idempotencyKey: `manager-message:${crypto.randomUUID()}`,
        dueAt
      });
      await recordAudit(client, req.auth, {
        entityType: "notification",
        entityId: queued.id,
        action: "queue",
        after: { customerId, dueAt, type: "manager_message" }
      });
      return queued;
    });
    data(res, { notification }, 201);
  }));

  router.get("/notifications", asyncRoute(async (req, res) => {
    const input = validate(listSchema, req.query);
    const values = [req.auth.organizationId];
    let status = "";
    if (input.status) {
      values.push(input.status);
      status = ` AND n.status = $${values.length}`;
    }
    values.push(input.limit);
    const result = await pool.query(
      `SELECT n.id, n.customer_id AS "customerId", c.name AS "customerName",
              n.booking_id AS "bookingId", n.type, n.destination, n.body, n.status,
              n.due_at AS "dueAt", n.sent_at AS "sentAt",
              n.delivered_at AS "deliveredAt",
              n.provider_message_id AS "providerMessageId",
              n.provider_status AS "providerStatus",
              n.failure_reason AS "failureReason", n.created_at AS "createdAt"
       FROM notifications n
       LEFT JOIN customers c
         ON c.id = n.customer_id AND c.organization_id = n.organization_id
       WHERE n.organization_id = $1${status}
       ORDER BY n.due_at DESC
       LIMIT $${values.length}`,
      values
    );
    data(res, { notifications: result.rows, providerConfigured: sender.configured !== false });
  }));

  router.get("/inbound-messages", asyncRoute(async (req, res) => {
    const input = validate(inboundListSchema, req.query);
    const result = await pool.query(
      `SELECT m.id, m.customer_id AS "customerId", c.name AS "customerName",
              m.from_phone AS "fromPhone", m.to_phone AS "toPhone", m.body,
              m.opt_out_type AS "optOutType", m.received_at AS "receivedAt"
       FROM inbound_messages m
       LEFT JOIN customers c
         ON c.id = m.customer_id AND c.organization_id = m.organization_id
       WHERE m.organization_id = $1
       ORDER BY m.received_at DESC
       LIMIT $2`,
      [req.auth.organizationId, input.limit]
    );
    data(res, { messages: result.rows });
  }));

  router.post("/notifications/send-due", asyncRoute(async (req, res) => {
    const results = await sendDueNotifications(pool, sender);
    data(res, {
      processed: results.length,
      sent: results.filter((item) => item.status === "sent").length,
      failed: results.filter((item) => item.status === "failed").length
    });
  }));

  router.post("/notifications/:id/cancel", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    const notification = await withTransaction(pool, async (client) => {
      const before = await client.query(
        "SELECT * FROM notifications WHERE id = $1 AND organization_id = $2",
        [id, req.auth.organizationId]
      );
      if (!before.rowCount || before.rows[0].status !== "queued") {
        throw new HttpError(404, "not_found", "Queued notification not found");
      }
      const result = await client.query(
        `UPDATE notifications SET status = 'cancelled'
         WHERE id = $1 AND organization_id = $2
         RETURNING id, status`,
        [id, req.auth.organizationId]
      );
      await recordAudit(client, req.auth, {
        entityType: "notification",
        entityId: id,
        action: "cancel",
        before: before.rows[0],
        after: result.rows[0]
      });
      return result.rows[0];
    });
    data(res, { notification });
  }));

  router.post("/notifications/:id/retry", asyncRoute(async (req, res) => {
    const id = validate(uuid, req.params.id);
    validate(z.object({}).strict(), req.body || {});
    const notification = await withTransaction(pool, async (client) => {
      const before = await client.query(
        "SELECT * FROM notifications WHERE id = $1 AND organization_id = $2",
        [id, req.auth.organizationId]
      );
      if (!before.rowCount) throw new HttpError(404, "not_found", "Notification not found");
      if (before.rows[0].status !== "failed") {
        throw new HttpError(409, "invalid_state", "Only a failed message can be retried");
      }
      const existingRetry = await client.query(
        `SELECT 1 FROM notifications
         WHERE organization_id = $1 AND idempotency_key LIKE $2
         LIMIT 1`,
        [req.auth.organizationId, `notification-retry:${id}:%`]
      );
      if (existingRetry.rowCount) {
        throw new HttpError(409, "retry_already_queued", "This failed message already has a retry");
      }
      const retryId = crypto.randomUUID();
      const result = await client.query(
        `INSERT INTO notifications
         (id, organization_id, customer_id, employee_id, booking_id, type,
          channel, destination, body, status, idempotency_key, due_at)
         SELECT $3, organization_id, customer_id, employee_id, booking_id, type,
                channel, destination, body, 'queued', $4, now()
         FROM notifications
         WHERE id = $1 AND organization_id = $2
         RETURNING id, status, due_at AS "dueAt"`,
        [
          id,
          req.auth.organizationId,
          retryId,
          `notification-retry:${id}:${retryId}`
        ]
      );
      await recordAudit(client, req.auth, {
        entityType: "notification",
        entityId: retryId,
        action: "retry",
        before: before.rows[0],
        after: { ...result.rows[0], retriedNotificationId: id }
      });
      return result.rows[0];
    });
    data(res, { notification });
  }));

  return router;
}
