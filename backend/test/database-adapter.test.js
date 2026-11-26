const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDatabase } = require("../db");

test("SQLite adapter preserves the database operations used by V12", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myclassroom-db-contract-"));
  const filename = path.join(directory, "nested", "contract.db");
  let db;

  try {
    db = createDatabase(filename, "sqlite");
    db.exec(`
      CREATE TABLE parents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE children (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL REFERENCES parents(id),
        name TEXT NOT NULL
      );
    `);

    const parent = db.prepare("INSERT INTO parents(name) VALUES(?)").run("Parent");
    assert.equal(Number(parent.lastInsertRowid), 1);
    assert.equal(parent.changes, 1);

    const child = db.prepare("INSERT INTO children(parent_id,name) VALUES(?,?)").run(parent.lastInsertRowid, "Child");
    assert.equal(Number(child.lastInsertRowid), 1);
    assert.equal(db.prepare("SELECT name FROM children WHERE id=?").get(child.lastInsertRowid).name, "Child");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM children").get().count, 1);

    assert.throws(
      () => db.prepare("INSERT INTO children(parent_id,name) VALUES(?,?)").run(999, "Orphan"),
      /FOREIGN KEY constraint failed/
    );

    const rollback = db.transaction(() => {
      db.prepare("INSERT INTO parents(name) VALUES(?)").run("Rolled back");
      throw new Error("rollback sentinel");
    });
    assert.throws(rollback, /rollback sentinel/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM parents").get().count, 1);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  } finally {
    if (db) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("database adapter refuses an unimplemented driver instead of silently falling back", () => {
  assert.throws(
    () => createDatabase(":memory:", "postgres"),
    /Only "sqlite" is available/
  );
});
