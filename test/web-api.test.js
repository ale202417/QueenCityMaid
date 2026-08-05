import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localDate } from "../src/web/api.js";

describe("web business date", () => {
  it("uses the Charlotte workday across the UTC midnight boundary", () => {
    assert.equal(localDate(new Date("2026-08-05T00:30:00.000Z")), "2026-08-04");
    assert.equal(localDate(new Date("2026-08-05T04:30:00.000Z")), "2026-08-05");
  });
});
