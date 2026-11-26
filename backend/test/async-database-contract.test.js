const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase, createAsyncSqliteDatabase } = require("../db");

test("async SQLite contract supports numbered parameters, reads, and write metadata", async () => {
  const db = createAsyncSqliteDatabase(":memory:");
  try {
    await db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL)");
    const inserted = await db.execute("INSERT INTO notes(title) VALUES($1)", ["First"]);
    assert.equal(inserted.rowCount, 1);
    assert.equal(inserted.insertId, 1);
    assert.deepEqual(await db.one("SELECT title FROM notes WHERE id=$1", [1]), { title: "First" });
    assert.deepEqual(await db.many("SELECT title FROM notes WHERE id IN ($1, $2) ORDER BY id", [1, 2]), [{ title: "First" }]);
  } finally {
    await db.close();
  }
});

test("async SQLite contract reorders and reuses numbered placeholders correctly", async () => {
  const db = createAsyncSqliteDatabase(":memory:");
  try {
    const row = await db.one("SELECT $2 AS second, $1 AS first, $2 AS repeated", ["A", "B"]);
    assert.deepEqual(row, { second: "B", first: "A", repeated: "B" });
  } finally {
    await db.close();
  }
});

test("async SQLite transaction commits scoped operations and returns callback result", async () => {
  const db = createAsyncSqliteDatabase(":memory:");
  try {
    await db.execute("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)");
    const value = await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO entries(value) VALUES($1)", ["inside"]);
      return (await tx.one("SELECT COUNT(*) AS count FROM entries")).count;
    });
    assert.equal(value, 1);
    assert.equal((await db.one("SELECT COUNT(*) AS count FROM entries")).count, 1);
  } finally {
    await db.close();
  }
});

test("async SQLite transaction rolls back after asynchronous callback failure", async () => {
  const db = createAsyncSqliteDatabase(":memory:");
  try {
    await db.execute("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)");
    await assert.rejects(db.transaction(async (tx) => {
      await tx.execute("INSERT INTO entries(value) VALUES($1)", ["rollback"]);
      await Promise.resolve();
      throw new Error("rollback sentinel");
    }), /rollback sentinel/);
    assert.equal((await db.one("SELECT COUNT(*) AS count FROM entries")).count, 0);
  } finally {
    await db.close();
  }
});

test("async SQLite connection serializes queued operations around transactions", async () => {
  const db = createAsyncSqliteDatabase(":memory:");
  try {
    await db.execute("CREATE TABLE sequence (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)");
    const transaction = db.transaction(async (tx) => {
      await tx.execute("INSERT INTO sequence(value) VALUES($1)", ["transaction"]);
      await new Promise((resolve) => setImmediate(resolve));
      await tx.execute("INSERT INTO sequence(value) VALUES($1)", ["transaction-end"]);
    });
    const outside = db.execute("INSERT INTO sequence(value) VALUES($1)", ["outside"]);
    await Promise.all([transaction, outside]);
    assert.deepEqual((await db.many("SELECT value FROM sequence ORDER BY id")).map((row) => row.value),
      ["transaction", "transaction-end", "outside"]);
  } finally {
    await db.close();
  }
});

test("legacy synchronous database entry point and explicit driver rejection remain unchanged", () => {
  const db = createDatabase(":memory:", "sqlite");
  try {
    db.exec("CREATE TABLE legacy (id INTEGER PRIMARY KEY)");
    assert.throws(() => createDatabase(":memory:", "postgres"), /Only "sqlite" is available/);
  } finally {
    db.close();
  }
});
