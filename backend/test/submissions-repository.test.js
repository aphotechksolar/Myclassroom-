const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createSubmissionRepository } = require("../repositories/submissions");

function setup() {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  sqlite.exec(`
    CREATE TABLE classes (id INTEGER PRIMARY KEY, teacher_id INTEGER, institution_id TEXT);
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY, title TEXT, max_score REAL, teacher_id INTEGER, class_id INTEGER
    );
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY, assignment_id INTEGER, student_id INTEGER,
      score REAL, feedback TEXT
    );
    INSERT INTO classes VALUES
      (10, 1, 'school-a'), (11, 2, 'school-a'), (12, 1, 'school-b');
    INSERT INTO assignments VALUES
      (20, 'Biology task', 100, 3, 10),
      (21, 'Chemistry task', 50, 2, 11),
      (22, 'Other school task', 100, 3, 12);
    INSERT INTO submissions VALUES
      (30, 20, 101, NULL, ''),
      (31, 21, 102, NULL, ''),
      (32, 22, 103, NULL, '');
  `);
  return { database, repository: createSubmissionRepository(database) };
}

test("assignment owner and class teacher can grade within their school", async () => {
  const { database, repository } = setup();
  try {
    const result = await repository.gradeSubmission({
      userId: 3, institutionId: "school-a", role: "teacher",
      submissionId: 30, score: 85, feedback: "Good work"
    });
    assert.deepEqual(result, { studentId: 101, assignmentTitle: "Biology task" });
    const row = await database.one("SELECT score, feedback FROM submissions WHERE id = $1", [30]);
    assert.deepEqual(row, { score: 85, feedback: "Good work" });

    await repository.gradeSubmission({
      userId: 1, institutionId: "school-a", role: "teacher",
      submissionId: 30, score: 90, feedback: ""
    });
    const updated = await database.one("SELECT score FROM submissions WHERE id = $1", [30]);
    assert.equal(updated.score, 90);
  } finally {
    await database.close();
  }
});

test("teachers cannot grade another teacher's submission or a different school's submission", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.gradeSubmission({
      userId: 1, institutionId: "school-a", role: "teacher",
      submissionId: 31, score: 40
    }), error => error.status === 403);
    await assert.rejects(repository.gradeSubmission({
      userId: 3, institutionId: "school-a", role: "teacher",
      submissionId: 32, score: 40
    }), error => error.status === 404);
  } finally {
    await database.close();
  }
});

test("school admins can grade any submission in their institution only", async () => {
  const { database, repository } = setup();
  try {
    const result = await repository.gradeSubmission({
      userId: 900, institutionId: "school-a", role: "school_admin",
      submissionId: 31, score: 45, feedback: "Reviewed"
    });
    assert.equal(result.studentId, 102);
    await assert.rejects(repository.gradeSubmission({
      userId: 900, institutionId: "school-a", role: "school_admin",
      submissionId: 32, score: 45
    }), error => error.status === 404);
  } finally {
    await database.close();
  }
});

test("grading validates score, identifiers and role", async () => {
  const { database, repository } = setup();
  try {
    const base = { userId: 1, institutionId: "school-a", role: "teacher", submissionId: 30 };
    await assert.rejects(repository.gradeSubmission({ ...base, score: -1 }), error => error.status === 400);
    await assert.rejects(repository.gradeSubmission({ ...base, score: 101 }), error => error.status === 400);
    await assert.rejects(repository.gradeSubmission({ ...base, submissionId: 0, score: 50 }), /valid submission ID/);
    await assert.rejects(repository.gradeSubmission({ ...base, role: "student", score: 50 }), /Only school admins and teachers/);
  } finally {
    await database.close();
  }
});
