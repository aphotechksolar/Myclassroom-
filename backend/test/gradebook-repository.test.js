const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createGradebookRepository}=require("../repositories/gradebook");
function setup(){
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 sqlite.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,teacher_id INTEGER,institution_id TEXT);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
 CREATE TABLE institution_memberships(id INTEGER PRIMARY KEY,user_id INTEGER,institution_id TEXT,status TEXT);
 CREATE TABLE assessments(id INTEGER PRIMARY KEY,class_id INTEGER);
 CREATE TABLE attempts(id INTEGER PRIMARY KEY,assessment_id INTEGER,student_id INTEGER,percentage REAL,status TEXT);
 CREATE TABLE assignments(id INTEGER PRIMARY KEY,class_id INTEGER,max_score REAL);
 CREATE TABLE submissions(id INTEGER PRIMARY KEY,assignment_id INTEGER,student_id INTEGER,score REAL);
 INSERT INTO users VALUES(1,'Teacher A','teacher'),(2,'Teacher B','teacher'),(101,'Student A','student'),(102,'Student B','student');
 INSERT INTO classes VALUES(10,'A Biology',1,'school-a'),(11,'A Chemistry',2,'school-a'),(12,'B Biology',1,'school-b');
 INSERT INTO enrollments VALUES(1,10,101),(2,11,102),(3,12,101);
 INSERT INTO institution_memberships VALUES(1,101,'school-a','active'),(2,102,'school-a','active'),(3,101,'school-b','active');
 INSERT INTO assessments VALUES(20,10),(21,11),(22,12);
 INSERT INTO attempts VALUES(1,20,101,80,'submitted'),(2,21,102,60,'submitted'),(3,22,101,99,'submitted');
 INSERT INTO assignments VALUES(30,10,20),(31,11,30);
 INSERT INTO submissions VALUES(1,30,101,18),(2,31,102,15);
 `);
 return {database,repository:createGradebookRepository(database)};
}
test("school admins see institution gradebook rows and averages",async()=>{
 const {database,repository}=setup();try{
  const rows=await repository.listForUser(900,"school-a","school_admin");
  assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.student_name),["Student A","Student B"]);
  assert.equal(rows[0].assessment_average,80);assert.equal(rows[0].assignment_average,90);
  assert.equal(rows[1].assessment_average,60);assert.equal(rows[1].assignment_average,50);
  assert.ok(rows.every(x=>x.class_id!==12));
 }finally{await database.close();}
});
test("teachers see only gradebook rows for their assigned classes",async()=>{
 const {database,repository}=setup();try{
  const rows=await repository.listForUser(1,"school-a","teacher");
  assert.deepEqual(rows.map(x=>x.class_id),[10]);assert.equal(rows[0].student_id,101);
 }finally{await database.close();}
});
test("gradebook rejects invalid scope and parent role",async()=>{
 const {database,repository}=setup();try{
  await assert.rejects(repository.listForUser(0,"school-a","school_admin"),/user ID/);
  await assert.rejects(repository.listForUser(1,"","teacher"),/institution ID/);
  await assert.rejects(repository.listForUser(1,"school-a","parent"),/Only school admins and teachers/);
 }finally{await database.close();}
});
