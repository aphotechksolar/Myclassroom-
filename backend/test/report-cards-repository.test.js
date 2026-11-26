const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createReportCardRepository}=require("../repositories/report-cards");
function setup(){
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 sqlite.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,role TEXT);
 CREATE TABLE institution_memberships(id INTEGER PRIMARY KEY,user_id INTEGER,institution_id TEXT,role TEXT,status TEXT);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,teacher_id INTEGER,institution_id TEXT);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
 CREATE TABLE subjects(id INTEGER PRIMARY KEY,name TEXT,class_id INTEGER);
 CREATE TABLE assessments(id INTEGER PRIMARY KEY,class_id INTEGER);
 CREATE TABLE attempts(id INTEGER PRIMARY KEY,assessment_id INTEGER,student_id INTEGER,percentage REAL,status TEXT);
 CREATE TABLE attendance(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER,status TEXT);
 CREATE TABLE institution_settings(id INTEGER PRIMARY KEY,institution_id TEXT,key TEXT,value TEXT);
 INSERT INTO users VALUES(1,'Teacher A','teacher@example.com','teacher'),(2,'Teacher B','teacher2@example.com','teacher'),
 (101,'Student A','student@example.com','student'),(102,'Student B','student2@example.com','student');
 INSERT INTO institution_memberships VALUES
 (1,1,'school-a','teacher','active'),(2,2,'school-a','teacher','active'),
 (3,101,'school-a','student','active'),(4,102,'school-a','student','active'),
 (5,101,'school-b','student','active');
 INSERT INTO classes VALUES(10,'A Biology',1,'school-a'),(11,'A Chemistry',2,'school-a'),(12,'B Biology',1,'school-b');
 INSERT INTO enrollments VALUES(1,10,101),(2,11,101),(3,10,102),(4,12,101);
 INSERT INTO subjects VALUES(20,'Biology',10),(21,'Chemistry',11),(22,'Other School',12);
 INSERT INTO assessments VALUES(30,10),(31,11),(32,12);
 INSERT INTO attempts VALUES(1,30,101,80,'submitted'),(2,31,101,60,'submitted'),(3,32,101,99,'submitted');
 INSERT INTO attendance VALUES(1,10,101,'present'),(2,11,101,'late'),(3,12,101,'absent');
 INSERT INTO institution_settings VALUES(1,'school-a','school_name','Aphotech Academy');
 `);
 return {database,repository:createReportCardRepository(database)};
}
test("school admins can view report cards within their institution",async()=>{
 const {database,repository}=setup();try{
  const report=await repository.getForUser(900,"school-a","school_admin",101,"School A");
  assert.equal(report.school,"Aphotech Academy");
  assert.equal(report.student.id,101);
  assert.deepEqual(report.subjects.map(x=>x.subject),["Biology","Chemistry"]);
  assert.equal(report.subjects[0].average,80);
  assert.equal(report.subjects[1].average,60);
  assert.equal(report.attendance.total,2);
  assert.equal(report.attendance.present,1);
  assert.equal(report.attendance.late,1);
 }finally{await database.close();}
});
test("students can view only their own report card",async()=>{
 const {database,repository}=setup();try{
  const own=await repository.getForUser(101,"school-a","student",101,"School A");
  assert.equal(own.student.id,101);
  await assert.rejects(repository.getForUser(101,"school-a","student",102,"School A"),error=>error.status===403);
 }finally{await database.close();}
});
test("teachers can view only students in classes they teach",async()=>{
 const {database,repository}=setup();try{
  assert.equal((await repository.getForUser(1,"school-a","teacher",101,"School A")).student.id,101);
  await assert.rejects(repository.getForUser(2,"school-a","teacher",101,"School A"),error=>error.status===403);
 }finally{await database.close();}
});
test("report cards deny cross-school, inactive, parent and invalid requests",async()=>{
 const {database,repository}=setup();try{
  await assert.rejects(repository.getForUser(900,"school-a","school_admin",999,"School A"),error=>error.status===404);
  await assert.rejects(repository.getForUser(900,"school-a","school_admin",101,"School B"),error=>error.status===404);
  await assert.rejects(repository.getForUser(1,"school-a","parent",101,"School A"),error=>error.status===403);
  await assert.rejects(repository.getForUser(1,"","teacher",101,"School A"),/institution ID/);
  await assert.rejects(repository.getForUser(1,"school-a","teacher","bad","School A"),/student ID/);
 }finally{await database.close();}
});
