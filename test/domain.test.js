import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculatePayroll,
  recurrenceDates,
  responseDueAt,
  splitTip
} from "../src/server/domain.js";

describe("lead response deadlines", () => {
  it("allows one hour during the workday", () => {
    assert.equal(
      responseDueAt("2026-07-24T14:30:00.000Z").toISOString(),
      "2026-07-24T15:30:00.000Z"
    );
  });

  it("moves after-hours and weekend leads to the next workday", () => {
    assert.equal(
      responseDueAt("2026-07-25T01:00:00.000Z").toISOString(),
      "2026-07-27T13:00:00.000Z"
    );
  });

  it("carries a deadline across the end of the workday", () => {
    assert.equal(
      responseDueAt("2026-07-24T20:30:00.000Z").toISOString(),
      "2026-07-27T12:30:00.000Z"
    );
  });
});

describe("recurring service dates", () => {
  it("supports biweekly and every-three-week schedules", () => {
    assert.deepEqual(
      recurrenceDates("2026-07-06", { type: "weekly", intervalWeeks: 2 }, 3),
      ["2026-07-06", "2026-07-20", "2026-08-03"]
    );
    assert.deepEqual(
      recurrenceDates("2026-07-06", { type: "weekly", intervalWeeks: 3 }, 3),
      ["2026-07-06", "2026-07-27", "2026-08-17"]
    );
  });

  it("supports monthly dates and nth weekdays", () => {
    assert.deepEqual(
      recurrenceDates("2026-01-31", { type: "monthly", dayOfMonth: 31 }, 3),
      ["2026-01-31", "2026-03-31", "2026-05-31"]
    );
    assert.deepEqual(
      recurrenceDates("2026-07-01", { type: "nth_weekday", weekday: 1, occurrence: 2 }, 3),
      ["2026-07-13", "2026-08-10", "2026-09-14"]
    );
  });

  it("supports a finite list of individual service dates", () => {
    assert.deepEqual(
      recurrenceDates("2026-08-01", {
        type: "dates",
        dates: ["2026-09-03", "2026-08-04", "2026-08-19"]
      }, 2),
      ["2026-08-04", "2026-08-19"]
    );
    assert.throws(
      () => recurrenceDates("2026-08-01", {
        type: "dates",
        dates: ["2026-08-04", "2026-08-04"]
      }, 2),
      /duplicates/
    );
  });
});

describe("tips and payroll", () => {
  it("splits every cent of a tip deterministically", () => {
    assert.deepEqual(splitTip(1001, ["b", "a"]), [
      { employeeId: "a", amountCents: 501 },
      { employeeId: "b", amountCents: 500 }
    ]);
  });

  it("calculates weekly overtime, tips, and one captain reimbursement per day", () => {
    const result = calculatePayroll({
      employees: [{ id: "employee-1", hourlyRateCents: 2000 }],
      entries: [
        { employeeId: "employee-1", workDate: "2026-07-20", paidMinutes: 1800 },
        { employeeId: "employee-1", workDate: "2026-07-24", paidMinutes: 900 },
        { employeeId: "employee-1", workDate: "2026-07-27", paidMinutes: 300 }
      ],
      tipShares: [
        { employeeId: "employee-1", workDate: "2026-07-24", amountCents: 2500 }
      ],
      captainDays: [
        { employeeId: "employee-1", workDate: "2026-07-20" },
        { employeeId: "employee-1", workDate: "2026-07-20" }
      ]
    });

    assert.deepEqual(result, [
      {
        employeeId: "employee-1",
        weekStartsOn: "2026-07-20",
        regularMinutes: 2400,
        overtimeMinutes: 300,
        hourlyRateCents: 2000,
        tipsCents: 2500,
        captainDays: 1,
        captainReimbursementCents: 1600,
        grossWagesCents: 99100
      },
      {
        employeeId: "employee-1",
        weekStartsOn: "2026-07-27",
        regularMinutes: 300,
        overtimeMinutes: 0,
        hourlyRateCents: 2000,
        tipsCents: 0,
        captainDays: 0,
        captainReimbursementCents: 0,
        grossWagesCents: 10000
      }
    ]);
  });

  it("rejects invalid recurrence and time data", () => {
    assert.throws(
      () => recurrenceDates("2026-07-01", { type: "weekly", intervalWeeks: 4 }, 2),
      /interval/
    );
    assert.throws(
      () => calculatePayroll({
        employees: [],
        entries: [{ employeeId: "missing", workDate: "2026-07-20", paidMinutes: 60 }]
      }),
      /known employee/
    );
  });
});
