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


test("assessment creation validates questions and notifies only enrolled class members", async () => {
  const { database, repository } = setup();
  try {
    const created = await repository.createForClass({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 10,
      title: "New Biology Quiz", type: "quiz", durationMinutes: 25, passMark: 60,
      questions: [
        { question: "What is a cell?", options: ["Basic unit", "Organ"], answer: 0 },
        { question: "Invalid question", options: ["Only one"], answer: 0 }
      ]
    });
    assert.ok(created.id > 0);
    assert.deepEqual(created.studentIds, [101]);
    const row = await database.one("SELECT * FROM assessments WHERE id = $1", [created.id]);
    assert.equal(row.title, "New Biology Quiz");
    assert.equal(row.duration_minutes, 25);
    assert.equal(row.pass_mark, 60);
    assert.deepEqual(JSON.parse(row.questions_json), [
      { question: "What is a cell?", options: ["Basic unit", "Organ"], answer: 0 }
    ]);
  } finally {
    await database.close();
  }
});

test("assessment creation allows school admins but restricts teachers to their own classes", async () => {
  const { database, repository } = setup();
  try {
    const adminCreated = await repository.createForClass({
      userId: 900, institutionId: "school-a", role: "school_admin", classId: 11,
      title: "School Chemistry Exam",
      questions: [{ question: "Q", options: ["A", "B"], answer: 1 }]
    });
    assert.ok(adminCreated.id > 0);
    assert.deepEqual(adminCreated.studentIds, [102]);

    await assert.rejects(repository.createForClass({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 11,
      title: "Not my class", questions: [{ question: "Q", options: ["A", "B"], answer: 0 }]
    }), error => error.status === 403);

    await assert.rejects(repository.createForClass({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 12,
      title: "Cross-school", questions: [{ question: "Q", options: ["A", "B"], answer: 0 }]
    }), error => error.status === 403);
  } finally {
    await database.close();
  }
});

test("assessment creation rejects invalid questions, class IDs and roles", async () => {
  const { database, repository } = setup();
  try {
    const base = {
      userId: 1, institutionId: "school-a", role: "teacher", classId: 10,
      title: "Invalid assessment"
    };
    await assert.rejects(repository.createForClass({ ...base, questions: "not-an-array" }), /Questions must be an array/);
    await assert.rejects(repository.createForClass({ ...base, questions: [{ question: "No options", options: [], answer: 0 }] }), /at least one valid question/);
    await assert.rejects(repository.createForClass({ ...base, classId: 0, questions: [{ options: ["A", "B"], answer: 0 }] }), /valid class ID/);
    await assert.rejects(repository.createForClass({ ...base, role: "student", questions: [{ options: ["A", "B"], answer: 0 }] }), /Only school admins and teachers/);
  } finally {
    await database.close();
  }
});
