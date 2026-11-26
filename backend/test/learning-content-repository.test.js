const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createLearningContentRepository } = require("../repositories/learning-content");

function setup() {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY, name TEXT, teacher_id INTEGER, institution_id TEXT
    );
    CREATE TABLE enrollments (id INTEGER PRIMARY KEY, class_id INTEGER, student_id INTEGER);
    CREATE TABLE materials (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, url TEXT, file_url TEXT,
      class_id INTEGER, teacher_id INTEGER, created_at TEXT
    );
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, due_date TEXT,
      class_id INTEGER, teacher_id INTEGER, max_score REAL, created_at TEXT
    );
    INSERT INTO users VALUES (1, 'Teacher One'), (2, 'Teacher Two');
    INSERT INTO classes VALUES
      (10, 'A Biology', 1, 'school-a'),
      (11, 'A Chemistry', 2, 'school-a'),
      (12, 'B Biology', 1, 'school-b');
    INSERT INTO enrollments VALUES (1, 10, 101), (2, 11, 102), (3, 12, 101);
    INSERT INTO materials VALUES
      (1, 'A Biology Notes', '', '', '/uploads/a.pdf', 10, 1, '2026-01-01'),
      (2, 'A Chemistry Notes', '', '', '', 11, 2, '2026-01-02'),
      (3, 'B Biology Notes', '', '', '', 12, 1, '2026-01-03');
    INSERT INTO assignments VALUES
      (1, 'A Biology Task', '', '2026-02-01', 10, 1, 100, '2026-01-01'),
      (2, 'A Chemistry Task', '', '2026-02-02', 11, 2, 100, '2026-01-02'),
      (3, 'B Biology Task', '', '2026-02-03', 12, 1, 100, '2026-01-03');
  `);
  return { database, repository: createLearningContentRepository(database) };
}

test("materials preserve admin, teacher and student visibility with school isolation", async () => {
  const { database, repository } = setup();
  try {
    const admin = await repository.listMaterialsForUser(900, "school-a", "school_admin");
    assert.deepEqual(admin.map(row => row.id), [2, 1]);
    const teacher = await repository.listMaterialsForUser(1, "school-a", "teacher");
    assert.deepEqual(teacher.map(row => row.id), [1]);
    const student = await repository.listMaterialsForUser(101, "school-a", "student");
    assert.deepEqual(student.map(row => row.id), [1]);
    assert.equal(student[0].class_name, "A Biology");
    assert.equal(student[0].teacher_name, "Teacher One");
    assert.equal(student[0].file_url, "/uploads/a.pdf");
  } finally {
    await database.close();
  }
});

test("assignments preserve admin, teacher and student visibility with school isolation", async () => {
  const { database, repository } = setup();
  try {
    const admin = await repository.listAssignmentsForUser(900, "school-a", "school_admin");
    assert.deepEqual(admin.map(row => row.id), [1, 2]);
    const teacher = await repository.listAssignmentsForUser(1, "school-a", "teacher");
    assert.deepEqual(teacher.map(row => row.id), [1]);
    const student = await repository.listAssignmentsForUser(101, "school-a", "student");
    assert.deepEqual(student.map(row => row.id), [1]);
    assert.equal(student[0].class_name, "A Biology");
    assert.equal(student[0].teacher_name, "Teacher One");
  } finally {
    await database.close();
  }
});

test("learning content repositories reject invalid authenticated scope", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.listMaterialsForUser(0, "school-a", "student"), /valid user ID/);
    await assert.rejects(repository.listAssignmentsForUser(1, "", "teacher"), /valid institution ID/);
    await assert.rejects(repository.listMaterialsForUser(1, "school-a", "parent"), /valid institution role/);
  } finally {
    await database.close();
  }
});
