import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, hashHex] = String(encoded).split(":");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function sessionToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
