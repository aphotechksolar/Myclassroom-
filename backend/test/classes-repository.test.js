const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createClassesRepository } = require("../repositories/classes");

function setup() {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY, name TEXT, code TEXT, description TEXT,
      teacher_id INTEGER, live_link TEXT, institution_id TEXT
    );
    CREATE TABLE enrollments (id INTEGER PRIMARY KEY, class_id INTEGER, student_id INTEGER);
    CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT, class_id INTEGER, teacher_id INTEGER);
    INSERT INTO users VALUES (1, 'Teacher One'), (2, 'Teacher Two');
    INSERT INTO classes VALUES
      (10, 'A Biology', 'A1', '', 1, '', 'school-a'),
      (11, 'A Chemistry', 'A2', '', 2, '', 'school-a'),
      (12, 'B Biology', 'B1', '', 1, '', 'school-b');
    INSERT INTO enrollments VALUES (1, 10, 101), (2, 11, 102), (3, 12, 101);
    INSERT INTO subjects VALUES
      (20, 'Biology', 10, 1),
      (21, 'Chemistry', 11, 2),
      (22, 'Other School Biology', 12, 1);
  `);
  return { database, repository: createClassesRepository(database) };
}

test("class reads preserve admin, teacher and student visibility within one institution", async () => {
  const { database, repository } = setup();
  try {
    const admin = await repository.listForUser(900, "school-a", "school_admin");
    assert.deepEqual(admin.map(row => row.id), [10, 11]);
    assert.equal(admin[0].student_count, 1);
    const teacher = await repository.listForUser(1, "school-a", "teacher");
    assert.deepEqual(teacher.map(row => row.id), [10]);
    const student = await repository.listForUser(101, "school-a", "student");
    assert.deepEqual(student.map(row => row.id), [10]);
    assert.equal(student[0].teacher_name, "Teacher One");
    assert.equal(student[0].student_count, undefined);
  } finally {
    await database.close();
  }
});

test("subject reads preserve role visibility and institution isolation", async () => {
  const { database, repository } = setup();
  try {
    const admin = await repository.listSubjectsForUser(900, "school-a", "school_admin");
    assert.deepEqual(admin.map(row => row.name), ["Biology", "Chemistry"]);
    const teacher = await repository.listSubjectsForUser(1, "school-a", "teacher");
    assert.deepEqual(teacher.map(row => row.name), ["Biology"]);
    const student = await repository.listSubjectsForUser(101, "school-a", "student");
    assert.deepEqual(student.map(row => row.name), ["Biology"]);
    assert.equal(student[0].class_name, "A Biology");
  } finally {
    await database.close();
  }
});

test("class and subject repositories reject invalid authenticated scope", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.listForUser(0, "school-a", "student"), /valid user ID/);
    await assert.rejects(repository.listForUser(1, "", "teacher"), /valid institution ID/);
    await assert.rejects(repository.listForUser(1, "school-a", "parent"), /valid institution role/);
    await assert.rejects(repository.listSubjectsForUser(1, "school-a", "unknown"), /valid institution role/);
  } finally {
    await database.close();
  }
});
