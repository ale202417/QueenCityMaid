const DAY_MS = 24 * 60 * 60 * 1000;
const formatterCache = new Map();

function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short"
    }));
  }
  return formatterCache.get(timeZone);
}

function zonedParts(date, timeZone) {
  const values = Object.fromEntries(
    formatter(timeZone).formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday)
  };
}

function localEpoch(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );
}

function fromZonedParts(parts, timeZone) {
  let value = new Date(localEpoch(parts));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(value, timeZone);
    const correction = localEpoch(parts) - localEpoch(actual);
    if (correction === 0) break;
    value = new Date(value.getTime() + correction);
  }
  return value;
}

export function zonedDateTime(dateValue, timeValue, timeZone = "America/New_York") {
  const date = parseDateOnly(dateValue);
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(timeValue);
  if (!match) throw new TypeError("Time must use HH:MM");
  return fromZonedParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: 0
  }, timeZone);
}

function shiftLocalDate(parts, days) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate()
  };
}

export function responseDueAt(receivedAt, {
  targetMinutes = 60,
  timeZone = "America/New_York",
  businessStartHour = 8,
  businessEndHour = 17,
  workdays = [1, 2, 3, 4, 5]
} = {}) {
  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime()) || targetMinutes <= 0) {
    throw new TypeError("A valid received time and positive target are required");
  }

  let local = zonedParts(received, timeZone);
  const minuteOfDay = local.hour * 60 + local.minute;
  const startMinute = businessStartHour * 60;
  const endMinute = businessEndHour * 60;

  if (!workdays.includes(local.weekday) || minuteOfDay >= endMinute) {
    do {
      local = { ...local, ...shiftLocalDate(local, 1) };
      local.weekday = (local.weekday + 1) % 7;
    } while (!workdays.includes(local.weekday));
    return fromZonedParts({ ...local, hour: businessStartHour, minute: targetMinutes, second: 0 }, timeZone);
  }

  if (minuteOfDay < startMinute) {
    return fromZonedParts({ ...local, hour: businessStartHour, minute: targetMinutes, second: 0 }, timeZone);
  }

  if (minuteOfDay + targetMinutes <= endMinute) {
    return new Date(received.getTime() + targetMinutes * 60_000);
  }

  const remainingToday = endMinute - minuteOfDay;
  let remaining = targetMinutes - remainingToday;
  do {
    local = { ...local, ...shiftLocalDate(local, 1) };
    local.weekday = (local.weekday + 1) % 7;
  } while (!workdays.includes(local.weekday));
  return fromZonedParts({ ...local, hour: businessStartHour, minute: remaining, second: 0 }, timeZone);
}

function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError("Date must use YYYY-MM-DD");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new TypeError("Date is invalid");
  return date;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function nthWeekday(year, monthIndex, weekday, occurrence) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (occurrence - 1) * 7;
  const result = new Date(Date.UTC(year, monthIndex, day));
  return result.getUTCMonth() === monthIndex ? result : null;
}

export function recurrenceDates(startsOn, rule, count) {
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new TypeError("Count must be between 1 and 500");
  }
  const start = parseDateOnly(startsOn);
  const dates = [];

  if (rule.type === "weekly") {
    if (![1, 2, 3].includes(rule.intervalWeeks)) {
      throw new TypeError("Weekly interval must be 1, 2, or 3");
    }
    for (let index = 0; index < count; index += 1) {
      dates.push(dateOnly(new Date(start.getTime() + index * rule.intervalWeeks * 7 * DAY_MS)));
    }
    return dates;
  }

  if (rule.type === "monthly") {
    const desiredDay = rule.dayOfMonth || start.getUTCDate();
    if (!Number.isInteger(desiredDay) || desiredDay < 1 || desiredDay > 31) {
      throw new TypeError("Monthly day must be between 1 and 31");
    }
    let monthOffset = 0;
    while (dates.length < count) {
      const year = start.getUTCFullYear();
      const month = start.getUTCMonth() + monthOffset;
      const candidate = new Date(Date.UTC(year, month, desiredDay));
      const normalizedMonth = ((month % 12) + 12) % 12;
      if (candidate.getUTCMonth() === normalizedMonth && candidate >= start) {
        dates.push(dateOnly(candidate));
      }
      monthOffset += 1;
    }
    return dates;
  }

  if (rule.type === "nth_weekday") {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6
      || !Number.isInteger(rule.occurrence) || rule.occurrence < 1 || rule.occurrence > 5) {
      throw new TypeError("Nth weekday requires a weekday from 0-6 and occurrence from 1-5");
    }
    let monthOffset = 0;
    while (dates.length < count) {
      const month = start.getUTCMonth() + monthOffset;
      const year = start.getUTCFullYear() + Math.floor(month / 12);
      const monthIndex = ((month % 12) + 12) % 12;
      const candidate = nthWeekday(year, monthIndex, rule.weekday, rule.occurrence);
      if (candidate && candidate >= start) dates.push(dateOnly(candidate));
      monthOffset += 1;
    }
    return dates;
  }

  throw new TypeError("Unsupported recurrence type");
}

export function splitTip(amountCents, employeeIds) {
  if (!Number.isInteger(amountCents) || amountCents < 0 || !employeeIds.length) {
    throw new TypeError("A nonnegative tip and at least one employee are required");
  }
  const ordered = [...new Set(employeeIds)].sort();
  const base = Math.floor(amountCents / ordered.length);
  let remainder = amountCents % ordered.length;
  return ordered.map((employeeId) => ({
    employeeId,
    amountCents: base + (remainder-- > 0 ? 1 : 0)
  }));
}

function mondayFor(dateValue) {
  const date = parseDateOnly(dateValue);
  const offset = (date.getUTCDay() + 6) % 7;
  return dateOnly(new Date(date.getTime() - offset * DAY_MS));
}

export function calculatePayroll({
  entries,
  employees,
  tipShares = [],
  captainDays = [],
  captainReimbursementCents = 1600
}) {
  const rates = new Map(employees.map((employee) => [employee.id, employee.hourlyRateCents]));
  const lines = new Map();
  const keyFor = (employeeId, weekStartsOn) => `${employeeId}:${weekStartsOn}`;

  for (const entry of entries) {
    if (!rates.has(entry.employeeId) || !Number.isInteger(entry.paidMinutes) || entry.paidMinutes < 0) {
      throw new TypeError("Each time entry requires a known employee and nonnegative paid minutes");
    }
    const weekStartsOn = mondayFor(entry.workDate);
    const key = keyFor(entry.employeeId, weekStartsOn);
    const line = lines.get(key) || {
      employeeId: entry.employeeId,
      weekStartsOn,
      paidMinutes: 0,
      tipsCents: 0,
      captainDays: 0
    };
    line.paidMinutes += entry.paidMinutes;
    lines.set(key, line);
  }

  for (const tip of tipShares) {
    const weekStartsOn = mondayFor(tip.workDate);
    const key = keyFor(tip.employeeId, weekStartsOn);
    const line = lines.get(key);
    if (line) line.tipsCents += tip.amountCents;
  }

  const uniqueCaptainDays = new Set();
  for (const day of captainDays) {
    const identity = `${day.employeeId}:${day.workDate}`;
    if (uniqueCaptainDays.has(identity)) continue;
    uniqueCaptainDays.add(identity);
    const weekStartsOn = mondayFor(day.workDate);
    const line = lines.get(keyFor(day.employeeId, weekStartsOn));
    if (line) line.captainDays += 1;
  }

  return [...lines.values()]
    .map((line) => {
      const regularMinutes = Math.min(line.paidMinutes, 2400);
      const overtimeMinutes = Math.max(0, line.paidMinutes - 2400);
      const hourlyRateCents = rates.get(line.employeeId);
      const regularWages = Math.round(regularMinutes * hourlyRateCents / 60);
      const overtimeWages = Math.round(overtimeMinutes * hourlyRateCents * 1.5 / 60);
      const captainPayCents = line.captainDays * captainReimbursementCents;
      return {
        employeeId: line.employeeId,
        weekStartsOn: line.weekStartsOn,
        regularMinutes,
        overtimeMinutes,
        hourlyRateCents,
        tipsCents: line.tipsCents,
        captainDays: line.captainDays,
        captainReimbursementCents: captainPayCents,
        grossWagesCents: regularWages + overtimeWages + line.tipsCents
          + captainPayCents
      };
    })
    .sort((a, b) => a.weekStartsOn.localeCompare(b.weekStartsOn)
      || a.employeeId.localeCompare(b.employeeId));
}
