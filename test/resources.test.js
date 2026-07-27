import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { createApp } from "../src/server/app.js";
import { hashPassword } from "../src/server/passwords.js";
import { testPool } from "./helpers.js";

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const pool = await testPool();
  const ids = {
    organizationA: crypto.randomUUID(),
    organizationB: crypto.randomUUID(),
    managerA: crypto.randomUUID(),
    cleanerA: crypto.randomUUID(),
    managerB: crypto.randomUUID(),
    cleanerEmployee: crypto.randomUUID()
  };
  const passwordHash = await hashPassword("correct-horse");
  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, 'Queen City Maid'), ($2, 'Other Cleaning')",
    [ids.organizationA, ids.organizationB]
  );
  for (const user of [
    [ids.managerA, ids.organizationA, "manager-a@example.com", "Manager A", "manager"],
    [ids.cleanerA, ids.organizationA, "cleaner-a@example.com", "Cleaner A", "cleaner"],
    [ids.managerB, ids.organizationB, "manager-b@example.com", "Manager B", "manager"]
  ]) {
    await pool.query(
      `INSERT INTO users (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [...user, passwordHash]
    );
  }
  await pool.query(
    `INSERT INTO employees
     (id, organization_id, user_id, first_name, last_name, phone, hourly_rate_cents)
     VALUES ($1, $2, $3, 'Cleaner', 'A', '704-555-0100', 1800)`,
    [ids.cleanerEmployee, ids.organizationA, ids.cleanerA]
  );

  const server = createApp({ pool, secureCookies: false }).listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  cleanups.push(
    () => pool.end(),
    () => new Promise(resolve => server.close(resolve))
  );
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { cookie, body, ...options } = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {
      response,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0]
    };
  }

  async function login(email) {
    return request("/api/auth/login", {
      method: "POST",
      body: { email, password: "correct-horse" }
    });
  }

  return { pool, ids, request, login };
}

async function create(request, cookie, path, body) {
  const result = await request(path, { method: "POST", cookie, body });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body.data;
}

describe("manager resources", () => {
  it("manages customers, properties, and service types", async () => {
    const { request, login } = await fixture();
    const { cookie } = await login("manager-a@example.com");

    const { customer } = await create(request, cookie, "/api/customers", {
      type: "residential",
      name: "Jamie Client",
      phone: "704-555-0111",
      email: "jamie@example.com",
      serviceFrequency: "biweekly",
      paymentMethod: "venmo"
    });
    const customerList = await request("/api/customers?status=active", { cookie });
    assert.equal(customerList.response.status, 200);
    assert.equal(customerList.body.data.pagination.total, 1);
    assert.equal(customerList.body.data.customers[0].id, customer.id);
    assert.equal(customerList.body.data.customers[0].serviceFrequency, "biweekly");
    assert.equal(customerList.body.data.customers[0].paymentMethod, "venmo");
    const customerDetail = await request(`/api/customers/${customer.id}`, { cookie });
    assert.equal(customerDetail.body.data.customer.name, "Jamie Client");

    const customerUpdate = await request(`/api/customers/${customer.id}`, {
      method: "PATCH",
      cookie,
      body: {
        internalNotes: "Prefers Tuesday mornings",
        serviceFrequency: "weekly",
        paymentMethod: "check"
      }
    });
    assert.equal(customerUpdate.response.status, 200);
    assert.equal(customerUpdate.body.data.customer.internalNotes, "Prefers Tuesday mornings");
    assert.equal(customerUpdate.body.data.customer.serviceFrequency, "weekly");
    assert.equal(customerUpdate.body.data.customer.paymentMethod, "check");

    const invalidPreferences = await request(`/api/customers/${customer.id}`, {
      method: "PATCH",
      cookie,
      body: { serviceFrequency: "sometimes" }
    });
    assert.equal(invalidPreferences.response.status, 400);

    const { property } = await create(request, cookie, "/api/properties", {
      customerId: customer.id,
      addressLine1: "123 Tryon Street",
      city: "Charlotte",
      postalCode: "28202",
      squareFeet: 2200,
      pets: "One dog"
    });
    const propertyDetail = await request(`/api/properties/${property.id}`, { cookie });
    assert.equal(propertyDetail.body.data.property.customerId, customer.id);
    const propertyUpdate = await request(`/api/properties/${property.id}`, {
      method: "PATCH",
      cookie,
      body: { accessInstructions: "Side door" }
    });
    assert.equal(propertyUpdate.body.data.property.accessInstructions, "Side door");
    const propertyList = await request(`/api/properties?customerId=${customer.id}`, { cookie });
    assert.equal(propertyList.body.data.properties.length, 1);
    const customerWithProperty = await request("/api/customers?q=Jamie", { cookie });
    assert.equal(customerWithProperty.body.data.customers[0].propertyCount, 1);

    const { serviceType } = await create(request, cookie, "/api/service-types", {
      name: "Deep Cleaning",
      category: "residential",
      defaultDurationMinutes: 300,
      referenceChecklist: ["Kitchen", "Bathrooms"]
    });
    const serviceUpdate = await request(`/api/service-types/${serviceType.id}`, {
      method: "PATCH",
      cookie,
      body: { defaultDurationMinutes: 330 }
    });
    assert.equal(serviceUpdate.body.data.serviceType.defaultDurationMinutes, 330);
    const serviceDetail = await request(`/api/service-types/${serviceType.id}`, { cookie });
    assert.equal(serviceDetail.body.data.serviceType.name, "Deep Cleaning");
    const serviceList = await request("/api/service-types?category=residential", { cookie });
    assert.equal(serviceList.body.data.serviceTypes.length, 1);

    const archivedProperty = await request(`/api/properties/${property.id}`, {
      method: "DELETE",
      cookie
    });
    assert.equal(archivedProperty.body.data.property.active, false);
    const activeProperties = await request(
      `/api/properties?customerId=${customer.id}&active=true`,
      { cookie }
    );
    assert.equal(activeProperties.body.data.pagination.total, 0);
    const archivedService = await request(`/api/service-types/${serviceType.id}`, {
      method: "DELETE",
      cookie
    });
    assert.equal(archivedService.body.data.serviceType.active, false);
    const archivedCustomer = await request(`/api/customers/${customer.id}`, {
      method: "DELETE",
      cookie
    });
    assert.equal(archivedCustomer.body.data.customer.status, "inactive");
  });

  it("paginates and searches customer records without a total-record cap", async () => {
    const { pool, ids, request, login } = await fixture();
    const { cookie } = await login("manager-a@example.com");
    for (let index = 0; index < 1020; index += 1) {
      await pool.query(
        `INSERT INTO customers (id, organization_id, type, name, phone, status)
         VALUES ($1, $2, 'residential', $3, $4, 'active')`,
        [
          crypto.randomUUID(),
          ids.organizationA,
          `Scale Customer ${String(index).padStart(3, "0")}`,
          `704555${String(index).padStart(4, "0")}`
        ]
      );
    }

    const first = await request("/api/customers?limit=50&offset=0", { cookie });
    const last = await request("/api/customers?limit=50&offset=1000", { cookie });
    assert.equal(first.body.data.pagination.total, 1020);
    assert.equal(first.body.data.customers.length, 50);
    assert.equal(last.body.data.customers.length, 20);
    assert.notEqual(first.body.data.customers[0].id, last.body.data.customers[0].id);

    const searched = await request("/api/customers?q=Scale%20Customer%201019", { cookie });
    assert.equal(searched.body.data.pagination.total, 1);
    assert.equal(searched.body.data.customers[0].name, "Scale Customer 1019");
  });

  it("manages employees, teams, availability, and quality feedback", async () => {
    const { request, login } = await fixture();
    const { cookie } = await login("manager-a@example.com");

    const { employee } = await create(request, cookie, "/api/employees", {
      firstName: "Taylor",
      lastName: "Driver",
      phone: "704-555-0122",
      hourlyRateCents: 2000,
      experienceLevel: "senior",
      canDrive: true
    });
    const employeeList = await request("/api/employees?active=true", { cookie });
    assert.ok(employeeList.body.data.employees.some(item => item.id === employee.id));
    const employeeUpdate = await request(`/api/employees/${employee.id}`, {
      method: "PATCH",
      cookie,
      body: { hourlyRateCents: 2100 }
    });
    assert.equal(employeeUpdate.body.data.employee.hourlyRateCents, 2100);

    const { team } = await create(request, cookie, "/api/teams", { name: "Team Uptown" });
    const teamUpdate = await request(`/api/teams/${team.id}`, {
      method: "PATCH",
      cookie,
      body: { name: "Team Uptown One" }
    });
    assert.equal(teamUpdate.body.data.team.name, "Team Uptown One");
    const teamDetail = await request(`/api/teams/${team.id}`, { cookie });
    assert.equal(teamDetail.body.data.team.id, team.id);
    const teamList = await request("/api/teams?active=true", { cookie });
    assert.ok(teamList.body.data.teams.some(item => item.id === team.id));
    const { teamMember } = await create(request, cookie, `/api/teams/${team.id}/members`, {
      employeeId: employee.id,
      isCaptain: true,
      effectiveFrom: "2026-07-27"
    });
    assert.equal(teamMember.isCaptain, true);
    const memberDetail = await request(
      `/api/teams/${team.id}/members/${employee.id}/2026-07-27`,
      { cookie }
    );
    assert.equal(memberDetail.body.data.teamMember.employeeId, employee.id);
    const memberUpdate = await request(
      `/api/teams/${team.id}/members/${employee.id}/2026-07-27`,
      { method: "PATCH", cookie, body: { effectiveTo: "2026-08-31" } }
    );
    assert.ok(memberUpdate.body.data.teamMember.effectiveTo);
    const members = await request(`/api/teams/${team.id}/members`, { cookie });
    assert.equal(members.body.data.teamMembers.length, 1);

    const { availabilityException } = await create(
      request,
      cookie,
      "/api/availability-exceptions",
      {
        employeeId: employee.id,
        startsAt: "2026-08-03T08:00:00-04:00",
        endsAt: "2026-08-03T17:00:00-04:00",
        reason: "Appointment"
      }
    );
    const availabilityUpdate = await request(
      `/api/availability-exceptions/${availabilityException.id}`,
      { method: "PATCH", cookie, body: { status: "approved" } }
    );
    assert.equal(availabilityUpdate.body.data.availabilityException.status, "approved");
    const availabilityDetail = await request(
      `/api/availability-exceptions/${availabilityException.id}`,
      { cookie }
    );
    assert.equal(availabilityDetail.response.status, 200);
    const availabilityList = await request(
      `/api/availability-exceptions?employeeId=${employee.id}&status=approved`,
      { cookie }
    );
    assert.equal(availabilityList.body.data.availabilityExceptions.length, 1);

    const { qualityFeedback } = await create(request, cookie, "/api/quality-feedback", {
      employeeId: employee.id,
      rating: 5,
      notes: "Excellent customer feedback",
      receivedAt: "2026-07-24"
    });
    const feedbackUpdate = await request(`/api/quality-feedback/${qualityFeedback.id}`, {
      method: "PATCH",
      cookie,
      body: { rating: 4 }
    });
    assert.equal(feedbackUpdate.body.data.qualityFeedback.rating, 4);
    const feedbackDetail = await request(`/api/quality-feedback/${qualityFeedback.id}`, { cookie });
    assert.equal(feedbackDetail.response.status, 200);
    const feedbackList = await request(`/api/quality-feedback?employeeId=${employee.id}`, { cookie });
    assert.equal(feedbackList.body.data.qualityFeedback.length, 1);
    const employeeDetail = await request(`/api/employees/${employee.id}`, { cookie });
    assert.equal(Number(employeeDetail.body.data.employee.qualityRating), 4);

    const deletedFeedback = await request(`/api/quality-feedback/${qualityFeedback.id}`, {
      method: "DELETE",
      cookie
    });
    assert.equal(deletedFeedback.body.data.deleted, true);
    const deletedAvailability = await request(
      `/api/availability-exceptions/${availabilityException.id}`,
      { method: "DELETE", cookie }
    );
    assert.equal(deletedAvailability.body.data.deleted, true);
    const deletedMember = await request(
      `/api/teams/${team.id}/members/${employee.id}/2026-07-27`,
      { method: "DELETE", cookie }
    );
    assert.equal(deletedMember.body.data.deleted, true);
    const archivedTeam = await request(`/api/teams/${team.id}`, { method: "DELETE", cookie });
    assert.equal(archivedTeam.body.data.team.active, false);
    const archivedEmployee = await request(`/api/employees/${employee.id}`, {
      method: "DELETE",
      cookie
    });
    assert.equal(archivedEmployee.body.data.employee.active, false);
  });

  it("rejects invalid input and limits cleaners to their own record", async () => {
    const { request, login, ids } = await fixture();
    const manager = await login("manager-a@example.com");
    const invalid = await request("/api/employees", {
      method: "POST",
      cookie: manager.cookie,
      body: {
        firstName: "Missing",
        lastName: "Rate",
        phone: "704-555-0133",
        hourlyRateCents: -1
      }
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "validation_error");

    const cleaner = await login("cleaner-a@example.com");
    const ownRecord = await request("/api/employees/me", { cookie: cleaner.cookie });
    assert.equal(ownRecord.response.status, 200);
    assert.equal(ownRecord.body.data.employee.id, ids.cleanerEmployee);

    const listDenied = await request("/api/customers", { cookie: cleaner.cookie });
    assert.equal(listDenied.response.status, 403);
    const mutationDenied = await request("/api/service-types", {
      method: "POST",
      cookie: cleaner.cookie,
      body: { name: "Regular", category: "residential" }
    });
    assert.equal(mutationDenied.response.status, 403);
  });

  it("does not expose or attach records across organizations", async () => {
    const { request, login } = await fixture();
    const managerA = await login("manager-a@example.com");
    const managerB = await login("manager-b@example.com");

    const { customer: otherCustomer } = await create(
      request,
      managerB.cookie,
      "/api/customers",
      { type: "commercial", name: "Other Client", phone: "980-555-0100" }
    );
    const hidden = await request(`/api/customers/${otherCustomer.id}`, { cookie: managerA.cookie });
    assert.equal(hidden.response.status, 404);

    const crossOrganizationProperty = await request("/api/properties", {
      method: "POST",
      cookie: managerA.cookie,
      body: {
        customerId: otherCustomer.id,
        addressLine1: "1 Hidden Road",
        city: "Charlotte",
        postalCode: "28203"
      }
    });
    assert.equal(crossOrganizationProperty.response.status, 404);

    const list = await request("/api/customers", { cookie: managerA.cookie });
    assert.ok(!list.body.data.customers.some(customer => customer.id === otherCustomer.id));
  });
});
