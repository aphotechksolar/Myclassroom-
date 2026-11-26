const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../db");
const { openAsyncSqliteDatabase } = require("../db/sqlite-async");
const { createTimetableRepository } = require("../repositories/timetable");
function setup() {
  const sqlite = createDatabase(":memory:");
  const database = openAsyncSqliteDatabase(sqlite);
  sqlite.exec("CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,teacher_id INTEGER,institution_id TEXT); CREATE TABLE subjects(id INTEGER PRIMARY KEY,name TEXT,class_id INTEGER,teacher_id INTEGER); CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER); CREATE TABLE timetable(id INTEGER PRIMARY KEY AUTOINCREMENT,class_id INTEGER,subject_id INTEGER,day TEXT,start_time TEXT,end_time TEXT,room TEXT); INSERT INTO classes VALUES(10,'A Class',1,'school-a'),(11,'B Class',2,'school-a'),(12,'Other School',1,'school-b'); INSERT INTO subjects VALUES(20,'Biology',10,1),(21,'Chemistry',11,2),(22,'Other',12,1); INSERT INTO enrollments VALUES(1,10,101),(2,12,101); INSERT INTO timetable(class_id,subject_id,day,start_time,end_time,room) VALUES(10,20,'Monday','09:00','10:00','Lab A'),(11,21,'Tuesday','10:00','11:00','Room B'),(12,22,'Wednesday','11:00','12:00','Room C');");
  return { database, repository: createTimetableRepository(database) };
}
test("timetable reads preserve admin, teacher and enrolled student visibility", async () => {
  const { database,repository } = setup();
  try {
    assert.deepEqual((await repository.listForUser(900,"school-a","school_admin")).map(x=>x.id),[1,2]);
    assert.deepEqual((await repository.listForUser(1,"school-a","teacher")).map(x=>x.id),[1]);
    const student=await repository.listForUser(101,"school-a","student");
    assert.deepEqual(student.map(x=>x.id),[1]); assert.equal(student[0].subject_name,"Biology");
  } finally { await database.close(); }
});
test("timetable creation enforces class, subject, role and institution scope", async () => {
  const { database,repository }=setup();
  try {
    const created=await repository.create({userId:1,institutionId:"school-a",role:"teacher",classId:10,subjectId:20,day:"friday",startTime:"12:00",endTime:"13:00",room:"Lab"});
    assert.ok(created.id>0);
    await assert.rejects(repository.create({userId:1,institutionId:"school-a",role:"teacher",classId:11,day:"Friday",startTime:"12:00",endTime:"13:00"}),/assigned classes/);
    await assert.rejects(repository.create({userId:1,institutionId:"school-a",role:"teacher",classId:10,subjectId:21,day:"Friday",startTime:"12:00",endTime:"13:00"}),/belong to this class/);
    await assert.rejects(repository.create({userId:900,institutionId:"school-a",role:"school_admin",classId:12,day:"Friday",startTime:"12:00",endTime:"13:00"}),/not found in this school/);
    await assert.rejects(repository.create({userId:101,institutionId:"school-a",role:"student",classId:10,day:"Friday",startTime:"12:00",endTime:"13:00"}),/Only school administrators/);
  } finally { await database.close(); }
});
test("timetable repository rejects invalid scope and incomplete schedule data", async () => {
  const { database,repository }=setup();
  try {
    await assert.rejects(repository.listForUser(0,"school-a","student"),/valid user ID/);
    await assert.rejects(repository.listForUser(1,"","teacher"),/valid institution ID/);
    await assert.rejects(repository.create({userId:1,institutionId:"school-a",role:"teacher",classId:10,day:"Funday",startTime:"09:00",endTime:"10:00"}),/valid day/);
    await assert.rejects(repository.create({userId:1,institutionId:"school-a",role:"teacher",classId:10,day:"Monday",startTime:"",endTime:"10:00"}),/times are required/);
  } finally { await database.close(); }
});
