const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createAnnouncementsRepository } = require("../repositories/announcements");

test("student announcement reads include school-wide and enrolled-class items only", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    sqlite.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE enrollments (id INTEGER PRIMARY KEY, class_id INTEGER, student_id INTEGER);
      CREATE TABLE announcements (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        class_id INTEGER, author_id INTEGER, institution_id TEXT NOT NULL
      );
      INSERT INTO users VALUES (90, 'Teacher');
      INSERT INTO classes VALUES (1, 'A class'), (2, 'B class');
      INSERT INTO enrollments VALUES (1, 1, 11), (2, 2, 12);
      INSERT INTO announcements VALUES
        (1, 'School A general', 'All A', NULL, 90, 'school-a'),
        (2, 'School A class', 'For student 11', 1, 90, 'school-a'),
        (3, 'School A other class', 'For student 12', 2, 90, 'school-a'),
        (4, 'School B general', 'All B', NULL, 90, 'school-b');
    `);

    const repository = createAnnouncementsRepository(database);
    const rows = await repository.listForUser(11, "school-a", true);
    assert.deepEqual(rows.map(row => row.title), ["School A class", "School A general"]);
    assert.ok(rows.every(row => row.institution_id === "school-a"));
  } finally {
    await database.close();
  }
});

test("non-student announcement reads remain scoped to their institution", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    sqlite.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE enrollments (id INTEGER PRIMARY KEY, class_id INTEGER, student_id INTEGER);
      CREATE TABLE announcements (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        class_id INTEGER, author_id INTEGER, institution_id TEXT NOT NULL
      );
      INSERT INTO announcements VALUES
        (1, 'A', 'School A', NULL, NULL, 'school-a'),
        (2, 'B', 'School B', NULL, NULL, 'school-b');
    `);

    const repository = createAnnouncementsRepository(database);
    const rows = await repository.listForUser(22, "school-a", false);
    assert.deepEqual(rows.map(row => row.title), ["A"]);
  } finally {
    await database.close();
  }
});

test("announcements repository rejects invalid authenticated scope", async () => {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  try {
    const repository = createAnnouncementsRepository(database);
    await assert.rejects(repository.listForUser(0, "school-a", true), /valid user ID/);
    await assert.rejects(repository.listForUser(11, "", true), /valid institution ID/);
    await assert.rejects(repository.listForUser(11, "school-a", "student"), /valid user role/);
  } finally {
    await database.close();
  }
});
