const errors = [];

function requireValue(name) {
  const value = process.env[name];
  if (!value) errors.push(`${name} is required`);
  return value;
}

function checkDatabaseUrl(name) {
  const value = requireValue(name);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      errors.push(`${name} must use PostgreSQL`);
    }
    if (["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
      errors.push(`${name} cannot point to a local database in production`);
    }
  } catch {
    errors.push(`${name} is not a valid database URL`);
  }
}

if (process.env.NODE_ENV !== "production") {
  errors.push("NODE_ENV must be production");
}
if (process.env.HOST !== "0.0.0.0") {
  errors.push("HOST must be 0.0.0.0");
}
if (process.env.SESSION_COOKIE_SECURE !== "true") {
  errors.push("SESSION_COOKIE_SECURE must be true");
}
if (process.env.TRUST_PROXY !== "true") {
  errors.push("TRUST_PROXY must be true");
}
if (process.env.RUN_MIGRATIONS_ON_START !== "false") {
  errors.push("RUN_MIGRATIONS_ON_START must be false");
}

checkDatabaseUrl("DATABASE_URL");
checkDatabaseUrl("MIGRATION_DATABASE_URL");

if (errors.length) {
  throw new Error(`Production environment is not safe:\n- ${errors.join("\n- ")}`);
}

console.log("Production environment check passed");
