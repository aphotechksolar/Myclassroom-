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
    CREATE TABLE attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, assessment_id INTEGER, student_id INTEGER,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, submitted_at TEXT,
      score REAL DEFAULT 0, percentage REAL DEFAULT 0, status TEXT DEFAULT 'in_progress',
      answers_json TEXT DEFAULT '{}', UNIQUE(assessment_id, student_id)
    );
    INSERT INTO users VALUES (1, 'Teacher One'), (2, 'Teacher Two');
    INSERT INTO classes VALUES
      (10, 'A Biology', 1, 'school-a'),
      (11, 'A Chemistry', 2, 'school-a'),
      (12, 'B Biology', 1, 'school-b');
    INSERT INTO enrollments VALUES (1, 10, 101), (2, 11, 102), (3, 12, 101);
    INSERT INTO assessments VALUES
      (20, 'A Biology Quiz', 'quiz', 20, 10, 1, 50, '[{"question":"Q1","options":["Correct","Wrong"],"answer":0},{"question":"Q2","options":["Correct","Wrong"],"answer":0}]', '2026-01-01'),
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
        { question: "What is a cell?", options: ["Basic unit", "Organ"], answer: 0 }
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
    await assert.rejects(repository.createForClass({ ...base, questions: [{ question: "No options", options: [], answer: 0 }] }), /between 2 and 10 options/);
    await assert.rejects(repository.createForClass({ ...base, classId: 0, questions: [{ options: ["A", "B"], answer: 0 }] }), /valid class ID/);
    await assert.rejects(repository.createForClass({ ...base, role: "student", questions: [{ options: ["A", "B"], answer: 0 }] }), /Only school admins and teachers/);
  } finally {
    await database.close();
  }
});


test("student assessment listings never expose answer keys", async () => {
  const { database, repository } = setup();
  try {
    const rows = await repository.listForUser(101, "school-a", "student");
    assert.equal(rows.length, 1);
    assert.equal(Object.hasOwn(rows[0], "questions_json"), false);
    assert.equal(rows[0].question_count, 2);
  } finally { await database.close(); }
});

test("students can start an enrolled assessment and receive questions without answers", async () => {
  const { database, repository } = setup();
  try {
    const started = await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    assert.ok(started.attempt.id > 0);
    assert.equal(started.attempt.status, "in_progress");
    assert.equal(started.questions.length, 2);
    assert.equal(Object.hasOwn(started.questions[0], "answer"), false);
    const again = await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    assert.equal(again.attempt.id, started.attempt.id);
  } finally { await database.close(); }
});

test("assessment start denies students outside the institution or class roster", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.startAttempt({ userId: 102, institutionId: "school-a", assessmentId: 20 }), error => error.status === 403);
    await assert.rejects(repository.startAttempt({ userId: 101, institutionId: "school-b", assessmentId: 20 }), error => error.status === 403);
  } finally { await database.close(); }
});

test("submissions are graded once and duplicate submissions return the saved result", async () => {
  const { database, repository } = setup();
  try {
    const started = await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    const result = await repository.submitAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20, answers: { 0: 0, 1: 1 } });
    assert.equal(result.id, started.attempt.id);
    assert.equal(result.score, 1);
    assert.equal(result.percentage, 50);
    assert.equal(result.status, "PASS");
    const duplicate = await repository.submitAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20, answers: { 0: 1, 1: 1 } });
    assert.equal(duplicate.score, 1);
    assert.equal(duplicate.answers_json, result.answers_json);
    await assert.rejects(repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 }), error => error.status === 400);
  } finally { await database.close(); }
});

test("submission rejects missing attempts, invalid answer payloads and cross-school access", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.submitAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20, answers: {} }), error => error.status === 400);
    await assert.rejects(repository.submitAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20, answers: [] }), /Answers must be an object/);
    await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    await assert.rejects(repository.submitAttempt({ userId: 101, institutionId: "school-b", assessmentId: 20, answers: {} }), error => error.status === 400);
  } finally { await database.close(); }
});

test("late exam submissions are closed by server time and cannot earn marks", async () => {
  const { database, repository } = setup();
  try {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await database.execute(
      "INSERT INTO attempts(assessment_id, student_id, expires_at) VALUES($1, $2, $3)",
      [20, 101, expiredAt]
    );
    const result = await repository.submitAttempt({
      userId: 101, institutionId: "school-a", assessmentId: 20,
      answers: { 0: 0, 1: 0 }
    });
    assert.equal(result.timed_out, true);
    assert.equal(result.status, "FAIL");
    assert.equal(result.score, 0);
    assert.equal(result.percentage, 0);
    assert.equal(result.answers_json, "{}");
    assert.equal(result.submitted_at, expiredAt);
  } finally { await database.close(); }
});

test("resuming an expired attempt finalizes it and commits the timeout", async () => {
  const { database, repository } = setup();
  try {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await database.execute(
      "INSERT INTO attempts(assessment_id, student_id, expires_at) VALUES($1, $2, $3)",
      [20, 101, expiredAt]
    );
    await assert.rejects(
      repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 }),
      error => error.status === 400 && error.attempt.timed_out === true
    );
    const saved = await database.one(
      "SELECT * FROM attempts WHERE assessment_id = $1 AND student_id = $2",
      [20, 101]
    );
    assert.equal(saved.submitted_at, expiredAt);
    assert.equal(saved.status, "FAIL");
    assert.equal(saved.answers_json, "{}");
  } finally { await database.close(); }
});

test("expiry sweep closes overdue attempts but leaves active and completed attempts alone", async () => {
  const { database, repository } = setup();
  try {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    await database.execute(
      "INSERT INTO attempts(assessment_id, student_id, expires_at) VALUES($1, $2, $3)",
      [20, 101, past]
    );
    await database.execute(
      "INSERT INTO attempts(assessment_id, student_id, expires_at) VALUES($1, $2, $3)",
      [21, 102, future]
    );
    await database.execute(
      "INSERT INTO attempts(assessment_id, student_id, expires_at, submitted_at, status) VALUES($1, $2, $3, $4, $5)",
      [22, 101, past, past, "PASS"]
    );
    assert.equal(await repository.expireOverdueAttempts(), 1);
    const overdue = await database.one("SELECT * FROM attempts WHERE assessment_id = $1 AND student_id = $2", [20, 101]);
    const active = await database.one("SELECT * FROM attempts WHERE assessment_id = $1 AND student_id = $2", [21, 102]);
    const completed = await database.one("SELECT * FROM attempts WHERE assessment_id = $1 AND student_id = $2", [22, 101]);
    assert.equal(overdue.status, "FAIL");
    assert.equal(overdue.score, 0);
    assert.equal(overdue.submitted_at, past);
    assert.equal(active.submitted_at, null);
    assert.equal(completed.status, "PASS");
  } finally { await database.close(); }
});

test("resuming an active attempt never extends its original deadline", async () => {
  const { database, repository } = setup();
  try {
    const started = await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    const originalDeadline = started.attempt.expires_at;
    const resumed = await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    assert.equal(resumed.attempt.expires_at, originalDeadline);
  } finally { await database.close(); }
});

test("answers autosave only for the enrolled student while the attempt is active", async () => {
  const { database, repository } = setup();
  try {
    await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    const saved = await repository.saveAttemptAnswers({
      userId: 101, institutionId: "school-a", assessmentId: 20, answers: { 0: 0, 1: 1, 99: 1, 1.5: 0, 0: 99 }
    });
    assert.equal(saved.ok, true);
    const row = await database.one("SELECT answers_json FROM attempts WHERE assessment_id = $1 AND student_id = $2", [20, 101]);
    assert.deepEqual(JSON.parse(row.answers_json), { 1: 1 });
    await assert.rejects(
      repository.saveAttemptAnswers({ userId: 102, institutionId: "school-a", assessmentId: 20, answers: { 0: 0 } }),
      error => error.status === 400
    );
  } finally { await database.close(); }
});

test("timed-out attempts are graded from the last server-saved answers, not late client answers", async () => {
  const { database, repository } = setup();
  try {
    const started = await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    await repository.saveAttemptAnswers({
      userId: 101, institutionId: "school-a", assessmentId: 20, answers: { 0: 0, 1: 1 }
    });
    const past = new Date(Date.now() - 60_000).toISOString();
    await database.execute("UPDATE attempts SET expires_at = $1 WHERE id = $2", [past, started.attempt.id]);
    const result = await repository.submitAttempt({
      userId: 101, institutionId: "school-a", assessmentId: 20, answers: { 0: 0, 1: 0 }
    });
    assert.equal(result.timed_out, true);
    assert.equal(result.score, 1);
    assert.equal(result.percentage, 50);
    assert.deepEqual(JSON.parse(result.answers_json), { 0: 0, 1: 1 });
  } finally { await database.close(); }
});

test("expiry sweep grades autosaved answers instead of discarding them", async () => {
  const { database, repository } = setup();
  try {
    const started = await repository.startAttempt({ userId: 101, institutionId: "school-a", assessmentId: 20 });
    await repository.saveAttemptAnswers({
      userId: 101, institutionId: "school-a", assessmentId: 20, answers: { 0: 0, 1: 1 }
    });
    const past = new Date(Date.now() - 60_000).toISOString();
    await database.execute("UPDATE attempts SET expires_at = $1 WHERE id = $2", [past, started.attempt.id]);
    assert.equal(await repository.expireOverdueAttempts(), 1);
    const result = await database.one("SELECT * FROM attempts WHERE id = $1", [started.attempt.id]);
    assert.equal(result.score, 1);
    assert.equal(result.percentage, 50);
    assert.equal(result.status, "PASS");
    assert.equal(result.submitted_at, past);
  } finally { await database.close(); }
});



test("assessment creation rejects invalid title, duration, pass mark and type", async () => {
  const { database, repository } = setup();
  try {
    const base = {
      userId: 1, institutionId: "school-a", role: "teacher", classId: 10,
      title: "Valid exam", questions: [{ question: "Q", options: ["A", "B"], answer: 0 }]
    };
    for (const title of ["", "   ", "x".repeat(161)]) {
      await assert.rejects(repository.createForClass({ ...base, title }), /Assessment title/);
    }
    for (const durationMinutes of [0, -1, 481, 1.5, "not-a-number"]) {
      await assert.rejects(repository.createForClass({ ...base, durationMinutes }), /duration must be between/);
    }
    for (const passMark of [-1, 100.1, "not-a-number"]) {
      await assert.rejects(repository.createForClass({ ...base, passMark }), /Pass mark must be between/);
    }
    await assert.rejects(repository.createForClass({ ...base, type: "homework" }), /type must be quiz or exam/);
    const zeroPass = await repository.createForClass({ ...base, passMark: 0 });
    const row = await database.one("SELECT pass_mark FROM assessments WHERE id = $1", [zeroPass.id]);
    assert.equal(row.pass_mark, 0);
  } finally { await database.close(); }
});

test("assessment creation rejects malformed or ambiguous questions instead of silently dropping them", async () => {
  const { database, repository } = setup();
  try {
    const base = {
      userId: 1, institutionId: "school-a", role: "teacher", classId: 10,
      title: "Strict validation", questions: [{ question: "Q", options: ["A", "B"], answer: 0 }]
    };
    const invalidQuestions = [
      [{ question: "", options: ["A", "B"], answer: 0 }],
      [{ question: "Q", options: ["A"], answer: 0 }],
      [{ question: "Q", options: ["A", "A"], answer: 0 }],
      [{ question: "Q", options: ["A", "B"], answer: 2 }],
      [{ question: "Q", options: ["A", "B"], answer: "0" }],
      [{ question: "Q", options: ["A", "B"], answer: 0 }, { question: "Broken", options: [], answer: 0 }],
      Array.from({ length: 101 }, () => ({ question: "Q", options: ["A", "B"], answer: 0 }))
    ];
    for (const questions of invalidQuestions) {
      await assert.rejects(repository.createForClass({ ...base, questions }));
    }
    const count = await database.one("SELECT COUNT(*) AS count FROM assessments");
    assert.equal(count.count, 3);
  } finally { await database.close(); }
});
