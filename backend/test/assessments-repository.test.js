const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createAssessmentsRepository } = require("../repositories/assessments");

function setup() {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY, name TEXT, teacher_id INTEGER, institution_id TEXT
    );
    CREATE TABLE enrollments (id INTEGER PRIMARY KEY, class_id INTEGER, student_id INTEGER);
    CREATE TABLE assessments (
      id INTEGER PRIMARY KEY, title TEXT, type TEXT, duration_minutes INTEGER,
      class_id INTEGER, teacher_id INTEGER, pass_mark REAL, questions_json TEXT,
      created_at TEXT
    );
    INSERT INTO users VALUES (1, 'Teacher One'), (2, 'Teacher Two');
    INSERT INTO classes VALUES
      (10, 'A Biology', 1, 'school-a'),
      (11, 'A Chemistry', 2, 'school-a'),
      (12, 'B Biology', 1, 'school-b');
    INSERT INTO enrollments VALUES (1, 10, 101), (2, 11, 102), (3, 12, 101);
    INSERT INTO assessments VALUES
      (20, 'A Biology Quiz', 'quiz', 20, 10, 1, 50, '[{"question":"Q1"},{"question":"Q2"}]', '2026-01-01'),
      (21, 'A Chemistry Exam', 'exam', 60, 11, 2, 40, '[{"question":"Q1"}]', '2026-01-02'),
      (22, 'B Biology Quiz', 'quiz', 20, 12, 1, 50, '[]', '2026-01-03');
  `);
  return { database, repository: createAssessmentsRepository(database) };
}

test("school admins see all assessments in their institution only", async () => {
  const { database, repository } = setup();
  try {
    const rows = await repository.listForUser(900, "school-a", "school_admin");
    assert.deepEqual(rows.map(row => row.id), [21, 20]);
    assert.deepEqual(rows.map(row => row.question_count), [1, 2]);
    assert.ok(rows.every(row => row.id !== 22));
    assert.equal(rows[0].class_name, "A Chemistry");
    assert.equal(rows[0].teacher_name, "Teacher Two");
  } finally {
    await database.close();
  }
});

test("teachers see assessments they own or for classes they teach", async () => {
  const { database, repository } = setup();
  try {
    const rows = await repository.listForUser(1, "school-a", "teacher");
    assert.deepEqual(rows.map(row => row.id), [20]);
    assert.equal(rows[0].teacher_name, "Teacher One");
  } finally {
    await database.close();
  }
});

test("students see assessments for enrolled classes only", async () => {
  const { database, repository } = setup();
  try {
    const rows = await repository.listForUser(101, "school-a", "student");
    assert.deepEqual(rows.map(row => row.id), [20]);
  } finally {
    await database.close();
  }
});

test("assessment listing rejects invalid authenticated scope", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.listForUser(0, "school-a", "student"), /valid user ID/);
    await assert.rejects(repository.listForUser(1, "", "teacher"), /valid institution ID/);
    await assert.rejects(repository.listForUser(1, "school-a", "parent"), /valid institution role/);
  } finally {
    await database.close();
  }
});
