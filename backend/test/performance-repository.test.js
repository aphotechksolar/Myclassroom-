const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createPerformanceRepository}=require("../repositories/performance");
function setup(){
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 sqlite.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,role TEXT);
 CREATE TABLE institution_memberships(id INTEGER PRIMARY KEY,user_id INTEGER,institution_id TEXT,role TEXT,status TEXT);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,teacher_id INTEGER,institution_id TEXT);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
 CREATE TABLE assessments(id INTEGER PRIMARY KEY,title TEXT,type TEXT,class_id INTEGER);
 CREATE TABLE attempts(id INTEGER PRIMARY KEY,assessment_id INTEGER,student_id INTEGER,percentage REAL,status TEXT,submitted_at TEXT);
 CREATE TABLE attendance(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER,status TEXT);
 INSERT INTO users VALUES(1,'Teacher A','ta@test','teacher'),(2,'Teacher B','tb@test','teacher'),(101,'Student A','sa@test','student'),(102,'Student B','sb@test','student');
 INSERT INTO institution_memberships VALUES(1,1,'school-a','teacher','active'),(2,2,'school-a','teacher','active'),(3,101,'school-a','student','active'),(4,102,'school-a','student','active'),(5,101,'school-b','student','active');
 INSERT INTO classes VALUES(10,'A Biology',1,'school-a'),(11,'A Chemistry',2,'school-a'),(12,'B Biology',1,'school-b');
 INSERT INTO enrollments VALUES(1,10,101),(2,11,102),(3,12,101);
 INSERT INTO assessments VALUES(20,'Biology Quiz','quiz',10),(21,'Chemistry Exam','exam',11),(22,'Other School','quiz',12);
 INSERT INTO attempts VALUES(1,20,101,80,'submitted','2026-11-01'),(2,21,102,70,'submitted','2026-11-02'),(3,22,101,99,'submitted','2026-11-03');
 INSERT INTO attendance VALUES(1,10,101,'present'),(2,10,101,'absent'),(3,12,101,'late');
 `);
 return {database,repository:createPerformanceRepository(database)};
}
test("students can only view their own performance in their selected institution",async()=>{
 const {database,repository}=setup();try{
  const result=await repository.getForUser(101,"school-a","student",102);
  assert.equal(result.student.id,101);assert.equal(result.results.length,1);
  assert.equal(result.results[0].title,"Biology Quiz");assert.deepEqual(result.attendance,[{status:"absent",c:1},{status:"present",c:1}]);
 }finally{await database.close();}
});
test("school admins can view active students in their institution",async()=>{
 const {database,repository}=setup();try{
  const result=await repository.getForUser(900,"school-a","school_admin",102);
  assert.equal(result.student.id,102);assert.equal(result.results[0].title,"Chemistry Exam");
 }finally{await database.close();}
});
test("teachers can view only students in their assigned classes",async()=>{
 const {database,repository}=setup();try{
  const result=await repository.getForUser(1,"school-a","teacher",101);
  assert.equal(result.student.id,101);
  await assert.rejects(repository.getForUser(1,"school-a","teacher",102),error=>error.status===403);
 }finally{await database.close();}
});
test("performance denies cross-school, inactive, parent and invalid student requests",async()=>{
 const {database,repository}=setup();try{
  assert.equal(await repository.getForUser(900,"school-a","school_admin",999),null);
  await assert.rejects(repository.getForUser(1,"school-a","parent",101),error=>error.status===403);
  await assert.rejects(repository.getForUser(900,"school-a","school_admin","bad"),/student ID/);
  assert.equal(await repository.getForUser(900,"school-b","school_admin",102),null);
 }finally{await database.close();}
});
