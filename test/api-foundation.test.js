import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { createApp } from "../src/server/app.js";
import { hashPassword } from "../src/server/passwords.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

async function fixture(secureCookies = false) {
  const pool = await testPool();
  const ids = {
    organizationA: crypto.randomUUID(),
    organizationB: crypto.randomUUID(),
    manager: crypto.randomUUID(),
    cleaner: crypto.randomUUID(),
    otherManager: crypto.randomUUID()
  };
  const passwordHash = await hashPassword("correct-horse");

  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, $2), ($3, $4)",
    [ids.organizationA, "Queen City Maid", ids.organizationB, "Other Cleaning"]
  );
  for (const user of [
    [ids.manager, ids.organizationA, "manager@example.com", "Manager", "manager"],
    [ids.cleaner, ids.organizationA, "cleaner@example.com", "Cleaner", "cleaner"],
    [ids.otherManager, ids.organizationB, "other@example.com", "Other Manager", "manager"]
  ]) {
    await pool.query(
      `INSERT INTO users (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [...user, passwordHash]
    );
  }

  const server = createApp({ pool, secureCookies }).listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  cleanups.push(
    () => new Promise(resolve => server.close(resolve)),
    () => pool.end()
  );
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { cookie, ...options } = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const body = await response.json();
    return { response, body, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }

  async function login(email, password = "correct-horse") {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  }

  return { pool, ids, request, login };
}

describe("authenticated API foundation", () => {
  it("reports health and supports login, current user, and logout", async () => {
    const { request, login, ids } = await fixture(true);

    const health = await request("/api/health");
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { data: { status: "ok" } });

    const signedIn = await login("MANAGER@example.com");
    assert.equal(signedIn.response.status, 200);
    assert.match(signedIn.response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(signedIn.response.headers.get("set-cookie"), /Secure/);
    assert.match(signedIn.response.headers.get("set-cookie"), /SameSite=Lax/i);
    assert.equal(signedIn.body.data.user.organization.id, ids.organizationA);

    const me = await request("/api/auth/me", { cookie: signedIn.cookie });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.data.user.role, "manager");

    const changed = await request("/api/auth/change-password", {
      method: "POST",
      cookie: signedIn.cookie,
      body: JSON.stringify({
        currentPassword: "correct-horse",
        newPassword: "new-correct-horse"
      })
    });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.data.changed, true);

    const signedOut = await request("/api/auth/logout", {
      method: "POST",
      cookie: signedIn.cookie
    });
    assert.equal(signedOut.response.status, 200);
    assert.deepEqual(signedOut.body, { data: { loggedOut: true } });

    const expired = await request("/api/auth/me", { cookie: signedIn.cookie });
    assert.equal(expired.response.status, 401);
    assert.equal(expired.body.error.code, "unauthorized");
  });

  it("returns consistent validation and credential failures", async () => {
    const { request, login } = await fixture();

    const invalid = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email", password: "short" })
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "validation_error");
    assert.ok(invalid.body.error.details.fieldErrors.email);
    assert.equal(invalid.response.headers.get("cache-control"), "no-store");

    const denied = await login("manager@example.com", "wrong-password");
    assert.equal(denied.response.status, 401);
    assert.deepEqual(denied.body, {
      error: {
        code: "invalid_credentials",
        message: "Email or password is incorrect"
      }
    });

    const missing = await request("/does-not-exist");
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, "not_found");
    assert.equal(missing.response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(missing.response.headers.get("x-frame-options"), "DENY");

    const crossOrigin = await request("/api/auth/login", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
      body: JSON.stringify({
        email: "manager@example.com",
        password: "correct-horse"
      })
    });
    assert.equal(crossOrigin.response.status, 403);
    assert.equal(crossOrigin.body.error.code, "origin_not_allowed");
  });

  it("accepts explicitly configured frontend origins", async () => {
    const previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "http://localhost:5180";
    try {
      const { request } = await fixture();
      const signedIn = await request("/api/auth/login", {
        method: "POST",
        headers: { origin: "http://localhost:5180" },
        body: JSON.stringify({
          email: "manager@example.com",
          password: "correct-horse"
        })
      });
      assert.equal(signedIn.response.status, 200);
    } finally {
      if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = previous;
    }
  });

  it("throttles repeated login failures and clears attempts after success", async () => {
    const { login } = await fixture();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const denied = await login("manager@example.com", "wrong-password");
      assert.equal(denied.response.status, 401);
    }
    const throttled = await login("manager@example.com", "wrong-password");
    assert.equal(throttled.response.status, 429);
    assert.equal(throttled.body.error.code, "too_many_attempts");
  });

  it("enforces manager permissions and organization isolation", async () => {
    const { pool, ids, request, login } = await fixture();
    await pool.query(
      `INSERT INTO audit_events
       (id, organization_id, actor_user_id, entity_type, action)
       VALUES ($1, $2, $3, 'user', 'other-organization-event')`,
      [crypto.randomUUID(), ids.organizationB, ids.otherManager]
    );

    const cleaner = await login("cleaner@example.com");
    const forbidden = await request("/api/audit-events", { cookie: cleaner.cookie });
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.body.error.code, "forbidden");
    const cleanerRoute = await request("/api/my-route?date=2026-07-24", {
      cookie: cleaner.cookie
    });
    assert.equal(cleanerRoute.response.status, 404);
    assert.equal(cleanerRoute.body.error.code, "employee_not_linked");

    const manager = await login("manager@example.com");
    const audit = await request("/api/audit-events?limit=10", { cookie: manager.cookie });
    assert.equal(audit.response.status, 200);
    assert.ok(audit.body.data.events.some(event => event.action === "login"));
    assert.ok(!audit.body.data.events.some(event => event.action === "other-organization-event"));
  });
});
