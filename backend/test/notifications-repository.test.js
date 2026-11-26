const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createNotificationsRepository } = require("../repositories/notifications");

function setup() {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
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
  return { sqlite, database, repository: createNotificationsRepository(database) };
}

test("notifications repository scopes results to both user and institution", async () => {
  const { database, repository } = setup();
  try {
    const rows = await repository.listForUser(11, "school-a");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "A1");
    assert.equal(rows[0].user_id, 11);
    assert.equal(rows[0].institution_id, "school-a");
  } finally {
    await database.close();
  }
});

test("notifications repository marks read only for the intended user and institution", async () => {
  const { database, repository } = setup();
  try {
    await repository.markRead(1, 11, "school-a");
    const own = await database.one("SELECT read_at FROM notifications WHERE id = $1", [1]);
    const otherUser = await database.one("SELECT read_at FROM notifications WHERE id = $1", [2]);
    const otherSchool = await database.one("SELECT read_at FROM notifications WHERE id = $1", [3]);
    assert.ok(own.read_at);
    assert.equal(otherUser.read_at, null);
    assert.equal(otherSchool.read_at, null);
  } finally {
    await database.close();
  }
});

test("notifications repository does not update another user's or school's notification", async () => {
  const { database, repository } = setup();
  try {
    await repository.markRead(2, 11, "school-a");
    await repository.markRead(3, 11, "school-a");
    const rows = await database.many("SELECT id, read_at FROM notifications ORDER BY id");
    assert.deepEqual(rows.map(row => row.read_at), [null, null, null]);
  } finally {
    await database.close();
  }
});

test("notifications repository rejects invalid identifiers and scope", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.listForUser(0, "school-a"), /valid user ID/);
    await assert.rejects(repository.listForUser(11, ""), /valid institution ID/);
    await assert.rejects(repository.listForUser(11, null), /valid institution ID/);
    await assert.rejects(repository.markRead(0, 11, "school-a"), /valid notification ID/);
    await assert.rejects(repository.markRead(1, 0, "school-a"), /valid user ID/);
  } finally {
    await database.close();
  }
});
