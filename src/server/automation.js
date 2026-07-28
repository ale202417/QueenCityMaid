import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { recordAudit, requireRole } from "./auth.js";
import {
  queueAutomatedPaymentReminders,
  queueAutomatedServiceReminders
} from "./communications.js";
import { HttpError, asyncRoute, data, validate } from "./http.js";
import { syncAlternatingWeeks } from "./schedule-planner.js";

const manualRunSchema = z.object({}).strict();
const RUN_STALE_AFTER_MS = 30 * 60 * 1000;

function localParts(value, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(value).map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

async function claimRun(pool, {
  organizationId,
  runKey,
  trigger,
  actorUserId,
  now
}) {
  const existing = await pool.query(
    `SELECT id, status, summary, error_message AS "errorMessage",
            started_at AS "startedAt", completed_at AS "completedAt"
     FROM automation_runs
     WHERE organization_id = $1 AND run_key = $2`,
    [organizationId, runKey]
  );
  if (existing.rows.length) {
    const current = existing.rows[0];
    const staleBefore = new Date(now.getTime() - RUN_STALE_AFTER_MS);
    const retryable = current.status === "failed"
      || (current.status === "running" && new Date(current.startedAt) < staleBefore);
    if (!retryable) return { ...current, claimed: false };
    const retried = await pool.query(
      `UPDATE automation_runs
       SET status = 'running', summary = '{}'::jsonb, error_message = NULL,
           started_at = $3, completed_at = NULL, created_by = COALESCE($4, created_by)
       WHERE organization_id = $1 AND run_key = $2
       RETURNING id`,
      [organizationId, runKey, now, actorUserId || null]
    );
    return { id: retried.rows[0].id, claimed: true };
  }

  const id = crypto.randomUUID();
  const inserted = await pool.query(
    `INSERT INTO automation_runs
     (id, organization_id, run_key, trigger, status, started_at, created_by)
     VALUES ($1, $2, $3, $4, 'running', $5, $6)
     ON CONFLICT (organization_id, run_key) DO NOTHING
     RETURNING id`,
    [id, organizationId, runKey, trigger, now, actorUserId || null]
  );
  if (inserted.rows.length) return { id, claimed: true };
  const raced = await pool.query(
    `SELECT id, status, summary, error_message AS "errorMessage",
            started_at AS "startedAt", completed_at AS "completedAt"
     FROM automation_runs
     WHERE organization_id = $1 AND run_key = $2`,
    [organizationId, runKey]
  );
  return { ...raced.rows[0], claimed: false };
}

export async function runOrganizationAutomation(pool, {
  organizationId,
  actorUserId = null,
  trigger = "manual",
  now = new Date(),
  runKey = `${trigger}:${crypto.randomUUID()}`
}) {
  const claim = await claimRun(pool, {
    organizationId,
    runKey,
    trigger,
    actorUserId,
    now
  });
  if (!claim.claimed) return { duplicate: true, run: claim };

  try {
    const settingsResult = await pool.query(
      `SELECT bs.schedule_automation_enabled AS "scheduleEnabled",
              bs.service_reminder_automation_enabled AS "serviceRemindersEnabled",
              bs.payment_reminder_automation_enabled AS "paymentRemindersEnabled",
              bs.payment_reminder_days AS "paymentReminderDays",
              o.timezone
       FROM business_settings bs
       JOIN organizations o ON o.id = bs.organization_id
       WHERE bs.organization_id = $1`,
      [organizationId]
    );
    if (!settingsResult.rowCount) {
      throw new HttpError(404, "not_found", "Business settings not found");
    }
    const settings = settingsResult.rows[0];
    const reference = localParts(now, settings.timezone).date;
    const summary = {
      schedule: { enabled: settings.scheduleEnabled, created: 0 },
      serviceReminders: {
        enabled: settings.serviceRemindersEnabled,
        queued: 0,
        existing: 0,
        skippedNoConsent: 0
      },
      paymentReminders: {
        enabled: settings.paymentRemindersEnabled,
        queued: 0,
        existing: 0,
        skippedNoConsent: 0,
        skippedNotDue: 0
      }
    };
    if (settings.scheduleEnabled) {
      const schedule = await syncAlternatingWeeks(
        pool,
        { organizationId },
        reference
      );
      summary.schedule.created = schedule.created;
      summary.schedule.rangeStart = schedule.rangeStart;
      summary.schedule.rangeEnd = schedule.rangeEnd;
    }
    if (settings.serviceRemindersEnabled) {
      Object.assign(
        summary.serviceReminders,
        await queueAutomatedServiceReminders(pool, organizationId, { now })
      );
    }
    if (settings.paymentRemindersEnabled) {
      Object.assign(
        summary.paymentReminders,
        await queueAutomatedPaymentReminders(pool, organizationId, {
          now,
          reminderDays: Number(settings.paymentReminderDays),
          timeZone: settings.timezone
        })
      );
    }
    const completed = await pool.query(
      `UPDATE automation_runs
       SET status = 'completed', summary = $3::jsonb, completed_at = $4
       WHERE id = $1 AND organization_id = $2
       RETURNING id, run_key AS "runKey", trigger, status, summary,
                 started_at AS "startedAt", completed_at AS "completedAt"`,
      [claim.id, organizationId, JSON.stringify(summary), new Date()]
    );
    return { duplicate: false, run: completed.rows[0] };
  } catch (error) {
    await pool.query(
      `UPDATE automation_runs
       SET status = 'failed', error_message = $3, completed_at = $4
       WHERE id = $1 AND organization_id = $2`,
      [
        claim.id,
        organizationId,
        String(error.message || error).slice(0, 1000),
        new Date()
      ]
    );
    throw error;
  }
}

export async function runDueAutomations(pool, now = new Date()) {
  const organizations = await pool.query(
    `SELECT bs.organization_id AS "organizationId",
            CAST(bs.automation_run_time AS text) AS "runTime",
            o.timezone
     FROM business_settings bs
     JOIN organizations o ON o.id = bs.organization_id
     WHERE bs.schedule_automation_enabled = true
        OR bs.service_reminder_automation_enabled = true
        OR bs.payment_reminder_automation_enabled = true`
  );
  const results = [];
  for (const organization of organizations.rows) {
    const local = localParts(now, organization.timezone);
    if (local.time < String(organization.runTime).slice(0, 5)) continue;
    results.push(await runOrganizationAutomation(pool, {
      organizationId: organization.organizationId,
      trigger: "scheduled",
      now,
      runKey: `daily:${local.date}`
    }));
  }
  return results;
}

export function createAutomationRouter({ pool, sender }) {
  if (!pool) throw new Error("pool is required");
  const router = Router();
  router.use(requireRole("manager"));

  router.get("/automations", asyncRoute(async (req, res) => {
    const [settings, runs] = await Promise.all([
      pool.query(
        `SELECT schedule_automation_enabled AS "scheduleEnabled",
                service_reminder_automation_enabled AS "serviceRemindersEnabled",
                payment_reminder_automation_enabled AS "paymentRemindersEnabled",
                CAST(automation_run_time AS text) AS "runTime",
                payment_reminder_days AS "paymentReminderDays"
         FROM business_settings
         WHERE organization_id = $1`,
        [req.auth.organizationId]
      ),
      pool.query(
        `SELECT id, run_key AS "runKey", trigger, status, summary,
                error_message AS "errorMessage", started_at AS "startedAt",
                completed_at AS "completedAt"
         FROM automation_runs
         WHERE organization_id = $1
         ORDER BY started_at DESC
         LIMIT 20`,
        [req.auth.organizationId]
      )
    ]);
    if (!settings.rowCount) {
      throw new HttpError(404, "not_found", "Business settings not found");
    }
    data(res, {
      settings: {
        ...settings.rows[0],
        runTime: String(settings.rows[0].runTime).slice(0, 5)
      },
      providerConfigured: sender?.configured !== false,
      runs: runs.rows
    });
  }));

  router.post("/automations/run", asyncRoute(async (req, res) => {
    validate(manualRunSchema, req.body || {});
    const result = await runOrganizationAutomation(pool, {
      organizationId: req.auth.organizationId,
      actorUserId: req.auth.id,
      trigger: "manual"
    });
    await recordAudit(pool, req.auth, {
      entityType: "automation_run",
      entityId: result.run.id,
      action: "run",
      after: result.run
    });
    data(res, result, 201);
  }));

  return router;
}
