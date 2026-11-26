const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createLearningContentRepository } = require("../repositories/learning-content");

function setup() {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
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
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY, assignment_id INTEGER, student_id INTEGER,
      answer TEXT, score REAL, feedback TEXT, submitted_at TEXT
    );
    CREATE TABLE institution_memberships (
      user_id INTEGER, institution_id TEXT, status TEXT
    );
    INSERT INTO users(id, name) VALUES
      (1, 'Teacher One'), (2, 'Teacher Two'),
      (101, 'Student One'), (102, 'Student Two'), (103, 'Inactive Student');
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
    INSERT INTO institution_memberships VALUES
      (101, 'school-a', 'active'), (102, 'school-a', 'active'),
      (101, 'school-b', 'active'), (103, 'school-a', 'suspended');
    INSERT INTO submissions VALUES
      (1, 1, 101, 'Answer A1', NULL, '', '2026-02-01'),
      (2, 2, 102, 'Answer A2', NULL, '', '2026-02-02'),
      (3, 3, 101, 'Answer B1', NULL, '', '2026-02-03'),
      (4, 1, 103, 'Suspended member', NULL, '', '2026-02-04');
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

test("material creation is scoped to the institution and class teacher", async () => {
  const { database, repository } = setup();
  try {
    const created = await repository.createMaterial({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 10,
      title: "New notes", description: "Chapter 2", url: "https://example.test",
      fileUrl: "/uploads/new.pdf"
    });
    assert.equal(created.material.title, "New notes");
    assert.equal(created.material.file_url, "/uploads/new.pdf");
    assert.deepEqual(created.studentIds, [101]);
    await assert.rejects(repository.createMaterial({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 11,
      title: "Forbidden", fileUrl: ""
    }), error => error.status === 403);
    await assert.rejects(repository.createMaterial({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 12,
      title: "Cross-school", fileUrl: ""
    }), error => error.status === 403);
  } finally {
    await database.close();
  }
});

test("assignment creation is scoped to the institution and class teacher", async () => {
  const { database, repository } = setup();
  try {
    const created = await repository.createAssignment({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 10,
      title: "New task", description: "Solve questions", dueDate: "2026-03-01", maxScore: 50
    });
    assert.equal(created.assignment.title, "New task");
    assert.equal(created.assignment.max_score, 50);
    assert.deepEqual(created.studentIds, [101]);
    const adminCreated = await repository.createAssignment({
      userId: 900, institutionId: "school-a", role: "school_admin", classId: 11,
      title: "Admin task"
    });
    assert.equal(adminCreated.assignment.max_score, 100);
    assert.deepEqual(adminCreated.studentIds, [102]);
    await assert.rejects(repository.createAssignment({
      userId: 1, institutionId: "school-a", role: "teacher", classId: 11, title: "Forbidden"
    }), error => error.status === 403);
    await assert.rejects(repository.createAssignment({
      userId: 101, institutionId: "school-a", role: "student", classId: 10, title: "Forbidden"
    }), /Only school admins and teachers/);
  } finally {
    await database.close();
  }
});


test("submissions preserve student, teacher and admin visibility with active membership and school isolation", async () => {
  const { database, repository } = setup();
  try {
    const student = await repository.listSubmissionsForUser(101, "school-a", "student");
    assert.deepEqual(student.map(row => row.id), [1]);
    assert.equal(student[0].student_name, "Student One");
    assert.equal(student[0].title, "A Biology Task");

    const teacher = await repository.listSubmissionsForUser(1, "school-a", "teacher");
    assert.deepEqual(teacher.map(row => row.id), [1]);

    const admin = await repository.listSubmissionsForUser(900, "school-a", "school_admin");
    assert.deepEqual(admin.map(row => row.id), [2, 1]);
    assert.ok(admin.every(row => row.id !== 3 && row.id !== 4));
  } finally {
    await database.close();
  }
});

test("submissions repository rejects invalid authenticated scope", async () => {
  const { database, repository } = setup();
  try {
    await assert.rejects(repository.listSubmissionsForUser(0, "school-a", "student"), /valid user ID/);
    await assert.rejects(repository.listSubmissionsForUser(1, "", "teacher"), /valid institution ID/);
    await assert.rejects(repository.listSubmissionsForUser(1, "school-a", "parent"), /valid institution role/);
  } finally {
    await database.close();
  }
});
