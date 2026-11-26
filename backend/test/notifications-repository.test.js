const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createNotificationsRepository } = require("../repositories/notifications");

test("notifications repository scopes results to both user and institution", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    sqlite.exec(`
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        read_at TEXT,
        institution_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO notifications(user_id, title, body, institution_id) VALUES
        (11, 'A1', 'For user 11 at school A', 'school-a'),
        (12, 'A2', 'For user 12 at school A', 'school-a'),
        (11, 'B1', 'For user 11 at school B', 'school-b');
    `);

    const repository = createNotificationsRepository(database);
    const rows = await repository.listForUser(11, "school-a");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "A1");
    assert.equal(rows[0].user_id, 11);
    assert.equal(rows[0].institution_id, "school-a");
  } finally {
    await database.close();
  }
});

test("notifications repository rejects missing or invalid scope", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    const repository = createNotificationsRepository(database);
    await assert.rejects(repository.listForUser(0, "school-a"), /valid user ID/);
    await assert.rejects(repository.listForUser(11, ""), /valid institution ID/);
    await assert.rejects(repository.listForUser(11, null), /valid institution ID/);
  } finally {
    await database.close();
  }
});
