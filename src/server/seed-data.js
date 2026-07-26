import crypto from "node:crypto";
import { hashPassword } from "./passwords.js";
import { responseDueAt } from "./domain.js";

export async function seed(pool, { password = "change-me-now" } = {}) {
  const existing = await pool.query("SELECT id FROM organizations WHERE name = $1", ["Queen City Maid"]);
  if (existing.rowCount) return { created: false, organizationId: existing.rows[0].id };

  const organizationId = crypto.randomUUID();
  const managerId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await pool.query("BEGIN");
  try {
    await pool.query(
      "INSERT INTO organizations (id, name) VALUES ($1, $2)",
      [organizationId, "Queen City Maid"]
    );
    await pool.query(
      `INSERT INTO business_settings (organization_id) VALUES ($1)`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, 'manager', $5)`,
      [managerId, organizationId, "manager@queencitymaid.local", "Queen City Maid Manager", passwordHash]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, 'manager', $5)`,
      [
        crypto.randomUUID(), organizationId, "operations@queencitymaid.local",
        "Operations Manager", passwordHash
      ]
    );

    const employees = [
      ["Angela", "Brooks", "7045550101", "2022-03-14", 1900, "senior", true],
      ["Maya", "Collins", "7045550102", "2023-06-05", 1750, "standard", false],
      ["Rosa", "Martinez", "7045550103", "2021-09-20", 1950, "senior", true],
      ["Nina", "Patel", "7045550104", "2024-02-12", 1700, "standard", false]
    ];
    const employeeIds = [];
    for (const employee of employees) {
      const employeeId = crypto.randomUUID();
      employeeIds.push(employeeId);
      await pool.query(
        `INSERT INTO employees
         (id, organization_id, first_name, last_name, phone, hire_date,
          hourly_rate_cents, experience_level, can_drive)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [employeeId, organizationId, ...employee]
      );
    }
    const captainUserId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, organization_id, email, name, role, password_hash)
       VALUES ($1, $2, 'captain@queencitymaid.local', 'Angela Brooks', 'cleaner', $3)`,
      [captainUserId, organizationId, passwordHash]
    );
    await pool.query(
      "UPDATE employees SET user_id = $1 WHERE id = $2",
      [captainUserId, employeeIds[0]]
    );

    const teams = [
      ["Crown", employeeIds[0], employeeIds[1]],
      ["Charlotte", employeeIds[2], employeeIds[3]]
    ];
    const teamIds = [];
    for (const [name, captainId, cleanerId] of teams) {
      const teamId = crypto.randomUUID();
      teamIds.push(teamId);
      await pool.query(
        "INSERT INTO teams (id, organization_id, name) VALUES ($1, $2, $3)",
        [teamId, organizationId, name]
      );
      await pool.query(
        `INSERT INTO team_members (team_id, employee_id, is_captain, effective_from)
         VALUES ($1, $2, true, CURRENT_DATE), ($1, $3, false, CURRENT_DATE)`,
        [teamId, captainId, cleanerId]
      );
    }

    const serviceIds = [];
    for (const [name, category, duration, checklist] of [
      ["Regular Cleaning", "residential", 180, ["Kitchen", "Bathrooms", "Bedrooms", "Floors"]],
      ["Deep Cleaning", "residential", 300, ["Kitchen", "Bathrooms", "Baseboards", "Fixtures", "Floors"]],
      ["Commercial Cleaning", "commercial", 240, ["Work areas", "Restrooms", "Common areas", "Floors"]],
      ["Basement", "addon", 60, ["Surfaces", "Floors"]],
      ["Patio", "addon", 60, ["Surfaces", "Debris"]]
    ]) {
      const serviceId = crypto.randomUUID();
      serviceIds.push(serviceId);
      await pool.query(
        `INSERT INTO service_types
         (id, organization_id, name, category, default_duration_minutes, reference_checklist)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [serviceId, organizationId, name, category, duration, JSON.stringify(checklist)]
      );
    }

    const customerId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO customers
       (id, organization_id, type, name, email, phone, status)
       VALUES ($1, $2, 'residential', 'Jordan Ellis', 'jordan@example.com', '7045550199', 'active')`,
      [customerId, organizationId]
    );
    const propertyId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO properties
       (id, organization_id, customer_id, address_line1, city, postal_code,
        square_feet, condition, pets, access_instructions)
       VALUES ($1, $2, $3, '1427 Queens Road', 'Charlotte', '28207',
               2400, 'maintained', 'One indoor cat', 'Text manager for entry code')`,
      [propertyId, organizationId, customerId]
    );
    await pool.query(
      `INSERT INTO text_consents
       (id, organization_id, customer_id, phone, status, source, recorded_by)
       VALUES ($1, $2, $3, '7045550199', 'granted', 'Customer text reply', $4)`,
      [crypto.randomUUID(), organizationId, customerId, managerId]
    );

    const receivedAt = new Date();
    await pool.query(
      `INSERT INTO leads
       (id, organization_id, owner_user_id, source, name, phone, message,
        status, received_at, response_due_at)
       VALUES ($1, $2, $3, 'Nextdoor', 'Taylor Morgan', '7045550188',
               'Biweekly cleaning for a three-bedroom home with a dog',
               'new', $4, $5)`,
      [
        crypto.randomUUID(), organizationId, managerId,
        receivedAt, responseDueAt(receivedAt)
      ]
    );

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const scheduledStart = new Date(`${today}T13:00:00.000Z`);
    const bookingId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO bookings
       (id, organization_id, customer_id, property_id, service_type_id, status,
        scheduled_start, expected_duration_minutes, price_cents, special_requests)
       VALUES ($1, $2, $3, $4, $5, 'assigned', $6, 180, 22000,
               'Please secure the patio door after service')`,
      [bookingId, organizationId, customerId, propertyId, serviceIds[0], scheduledStart]
    );
    const routeId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO routes
       (id, organization_id, team_id, captain_employee_id, service_date, status,
        estimated_paid_minutes, estimated_finish_at, finalized_by, finalized_at)
       VALUES ($1, $2, $3, $4, $5, 'finalized', 480, $6, $7, now())`,
      [
        routeId, organizationId, teamIds[0], employeeIds[0], today,
        new Date(`${today}T21:00:00.000Z`), managerId
      ]
    );
    await pool.query(
      `INSERT INTO route_stops
       (id, organization_id, route_id, booking_id, stop_order,
        estimated_arrival, estimated_departure, travel_minutes_from_previous)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 0)`,
      [
        crypto.randomUUID(), organizationId, routeId, bookingId,
        scheduledStart, new Date(`${today}T16:00:00.000Z`)
      ]
    );
    await pool.query(
      `INSERT INTO job_assignments (booking_id, employee_id, role)
       VALUES ($1, $2, 'captain'), ($1, $3, 'cleaner')`,
      [bookingId, employeeIds[0], employeeIds[1]]
    );
    await pool.query(
      `INSERT INTO customer_charges
       (id, organization_id, customer_id, booking_id, type, description,
        amount_cents, status, charged_on)
       VALUES ($1, $2, $3, $4, 'service', 'Regular cleaning', 22000, 'unpaid', $5)`,
      [crypto.randomUUID(), organizationId, customerId, bookingId, today]
    );

    await pool.query("COMMIT");
    return { created: true, organizationId, managerId };
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}
