import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withTransaction } from "../src/server/db.js";

function transactionFixture() {
  const queries = [];
  let released = false;
  const client = {
    async query(sql) {
      queries.push(sql);
    },
    release() {
      released = true;
    }
  };
  return {
    pool: { async connect() { return client; } },
    client,
    queries,
    released: () => released
  };
}

describe("database transactions", () => {
  it("commits successful work and releases the client", async () => {
    const fixture = transactionFixture();
    const result = await withTransaction(fixture.pool, async () => "saved");
    assert.equal(result, "saved");
    assert.deepEqual(fixture.queries, ["BEGIN", "COMMIT"]);
    assert.equal(fixture.released(), true);
  });

  it("rolls back failed work and releases the client", async () => {
    const fixture = transactionFixture();
    const failure = new Error("audit failed");
    await assert.rejects(
      withTransaction(fixture.pool, async () => { throw failure; }),
      failure
    );
    assert.deepEqual(fixture.queries, ["BEGIN", "ROLLBACK"]);
    assert.equal(fixture.released(), true);
  });
});
