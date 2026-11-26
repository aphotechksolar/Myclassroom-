const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createRankingsRepository}=require("../repositories/rankings");
function setup(){
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 sqlite.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT,teacher_id INTEGER,institution_id TEXT);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
 CREATE TABLE institution_memberships(id INTEGER PRIMARY KEY,user_id INTEGER,institution_id TEXT,role TEXT,status TEXT);
 CREATE TABLE assessments(id INTEGER PRIMARY KEY,class_id INTEGER);
 CREATE TABLE attempts(id INTEGER PRIMARY KEY,assessment_id INTEGER,student_id INTEGER,percentage REAL,status TEXT);
 INSERT INTO users VALUES(1,'Teacher A','teacher'),(101,'A Student','student'),(102,'B Student','student'),(103,'Inactive Student','student');
 INSERT INTO classes VALUES(10,'A Biology',1,'school-a'),(11,'A Chemistry',1,'school-a'),(12,'B Biology',1,'school-b');
 INSERT INTO enrollments VALUES(1,10,101),(2,10,102),(3,10,103),(5,12,101);
 INSERT INTO institution_memberships VALUES
  (1,1,'school-a','teacher','active'),
  (2,101,'school-a','student','active'),
  (3,102,'school-a','student','active'),
  (4,103,'school-a','student','inactive'),
  (5,101,'school-b','student','active');
 INSERT INTO assessments VALUES(20,10),(21,11),(22,12);
 INSERT INTO attempts VALUES
  (1,20,101,80,'submitted'),(2,20,102,90,'submitted'),
  (3,21,101,20,'submitted'),(4,22,101,100,'submitted');
 `);
 return {database,repository:createRankingsRepository(database)};
}
test("school admins receive class rankings scoped to active students in their school",async()=>{
 const {database,repository}=setup();try{
  const rows=await repository.listForClass(900,"school-a","school_admin",10);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.id),[102,101]);
  assert.equal(rows[0].average,90);
  assert.equal(rows[1].average,80);
 }finally{await database.close();}
});
test("teachers can rank only classes assigned to them",async()=>{
 const {database,repository}=setup();try{
  assert.equal((await repository.listForClass(1,"school-a","teacher",10)).length,2);
  assert.equal(await repository.listForClass(2,"school-a","teacher",10),null);
 }finally{await database.close();}
});
test("students can view rankings only for a class they are enrolled in",async()=>{
 const {database,repository}=setup();try{
  assert.equal((await repository.listForClass(101,"school-a","student",10)).length,2);
  assert.equal(await repository.listForClass(101,"school-a","student",11),null);
 }finally{await database.close();}
});
test("rankings reject cross-school, inactive, invalid and parent access",async()=>{
 const {database,repository}=setup();try{
  assert.equal(await repository.listForClass(900,"school-a","school_admin",12),null);
  assert.equal(await repository.listForClass(900,"school-a","school_admin",999),null);
  await assert.rejects(repository.listForClass(1,"school-a","parent",10),error=>error.status===403);
  await assert.rejects(repository.listForClass(1,"school-a","teacher","bad"),/class ID/);
 }finally{await database.close();}
});
