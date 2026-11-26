const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createPeopleRepository}=require("../repositories/people");
function setup(){
 const sqlite=createDatabase(":memory:"), database=openAsyncSqliteDatabase(sqlite);
 sqlite.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,phone TEXT,bio TEXT);
 CREATE TABLE institution_memberships(id INTEGER PRIMARY KEY,institution_id TEXT,user_id INTEGER,role TEXT,status TEXT);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,institution_id TEXT,teacher_id INTEGER);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
 INSERT INTO users VALUES (1,'Teacher A','ta@test','',''),(2,'Teacher B','tb@test','',''),
 (3,'Student A','sa@test','',''),(4,'Student B','sb@test','',''),(5,'Other School','o@test','',''),(6,'Inactive','i@test','','');
 INSERT INTO institution_memberships VALUES
 (1,'school-a',1,'teacher','active'),(2,'school-a',2,'teacher','active'),
 (3,'school-a',3,'student','active'),(4,'school-a',4,'student','active'),
 (5,'school-b',5,'student','active'),(6,'school-a',6,'student','suspended');
 INSERT INTO classes VALUES (10,'school-a',1),(11,'school-a',2),(12,'school-b',1);
 INSERT INTO enrollments VALUES (1,10,3),(2,11,4),(3,12,5);
 `);
 return {database,repository:createPeopleRepository(database)};
}
test("school administrators see active students only in their institution",async()=>{
 const {database,repository}=setup(); try {
  const rows=await repository.listStudentsForUser(99,"school-a","school_admin");
  assert.deepEqual(rows.map(x=>x.id),[3,4]);
 } finally {await database.close();}
});
test("teachers see students in their own classes only",async()=>{
 const {database,repository}=setup(); try {
  const rows=await repository.listStudentsForUser(1,"school-a","teacher");
  assert.deepEqual(rows.map(x=>x.id),[3]);
 } finally {await database.close();}
});
test("teacher directory is institution-scoped and administrator-only",async()=>{
 const {database,repository}=setup(); try {
  const rows=await repository.listTeachersForInstitution("school-a","school_admin");
  assert.deepEqual(rows.map(x=>x.id),[1,2]);
  await assert.rejects(repository.listTeachersForInstitution("school-a","teacher"),/Only a school administrator/);
 } finally {await database.close();}
});
test("people directory rejects invalid user and institution scope",async()=>{
 const {database,repository}=setup(); try {
  await assert.rejects(repository.listStudentsForUser(0,"school-a","teacher"),/valid user ID/);
  await assert.rejects(repository.listStudentsForUser(1,"","teacher"),/valid institution ID/);
  await assert.rejects(repository.listStudentsForUser(1,"school-a","parent"),/valid directory role/);
  await assert.rejects(repository.listTeachersForInstitution("","school_admin"),/valid institution ID/);
 } finally {await database.close();}
});
