const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createMessagesRepository } = require("../repositories/messages");

test("messages repository returns only the user's messages within the active institution", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    sqlite.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE institution_memberships (
        user_id INTEGER NOT NULL,
        institution_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        subject TEXT DEFAULT '',
        body TEXT NOT NULL,
        read_at TEXT,
        institution_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users VALUES (11, 'A Student'), (12, 'A Teacher'), (13, 'Other A User'), (21, 'B User'), (31, 'Inactive User');
      INSERT INTO institution_memberships VALUES
        (11, 'school-a', 'active'),
        (12, 'school-a', 'active'),
        (13, 'school-a', 'active'),
        (21, 'school-b', 'active'),
        (31, 'school-a', 'suspended');
      INSERT INTO messages VALUES
        (1, 12, 11, 'Received', 'Message to user 11', NULL, 'school-a', CURRENT_TIMESTAMP),
        (2, 11, 12, 'Sent', 'Message from user 11', NULL, 'school-a', CURRENT_TIMESTAMP),
        (3, 13, 12, 'Unrelated', 'Not involving user 11', NULL, 'school-a', CURRENT_TIMESTAMP),
        (4, 21, 11, 'Other school', 'Cross-school participant', NULL, 'school-b', CURRENT_TIMESTAMP),
        (5, 31, 11, 'Inactive sender', 'Sender no longer active', NULL, 'school-a', CURRENT_TIMESTAMP);
    `);

    const repository = createMessagesRepository(database);
    const rows = await repository.listForUser(11, "school-a");
    assert.deepEqual(rows.map(row => row.id), [2, 1]);
    assert.ok(rows.every(row => row.institution_id === "school-a"));
    assert.deepEqual(rows.map(row => [row.sender_name, row.receiver_name]), [
      ["A Student", "A Teacher"],
      ["A Teacher", "A Student"]
    ]);
  } finally {
    await database.close();
  }
});

test("messages repository rejects invalid authenticated scope", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    const repository = createMessagesRepository(database);
    await assert.rejects(repository.listForUser(0, "school-a"), /valid user ID/);
    await assert.rejects(repository.listForUser(11, ""), /valid institution ID/);
    await assert.rejects(repository.listForUser(11, null), /valid institution ID/);
  } finally {
    await database.close();
  }
});


test("only the intended receiver can mark a message read within its institution", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    sqlite.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        read_at TEXT,
        institution_id TEXT NOT NULL
      );
      INSERT INTO messages VALUES
        (1, 12, 11, 'School A message', NULL, 'school-a'),
        (2, 12, 21, 'School B message', NULL, 'school-b');
    `);

    const repository = createMessagesRepository(database);
    await repository.markRead(1, 11, "school-a");
    assert.ok(sqlite.prepare("SELECT read_at FROM messages WHERE id = 1").get().read_at);

    await repository.markRead(1, 12, "school-a");
    await repository.markRead(2, 11, "school-a");
    assert.equal(sqlite.prepare("SELECT read_at FROM messages WHERE id = 2").get().read_at, null);
  } finally {
    await database.close();
  }
});

test("message read receipt rejects invalid identifiers and institution scope", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    const repository = createMessagesRepository(database);
    await assert.rejects(repository.markRead("bad", 11, "school-a"), /valid user ID/);
    await assert.rejects(repository.markRead(1, 0, "school-a"), /valid user ID/);
    await assert.rejects(repository.markRead(1, 11, ""), /valid institution ID/);
  } finally {
    await database.close();
  }
});
