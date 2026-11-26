const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createAttendanceRepository}=require("../repositories/attendance");
function setup(){
 const sqlite=createDatabase(":memory:"), database=openAsyncSqliteDatabase(sqlite);
 sqlite.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,institution_id TEXT,teacher_id INTEGER);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
 CREATE TABLE attendance(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER,date TEXT,status TEXT);
 INSERT INTO users VALUES(1,'Teacher A','ta@test'),(2,'Student A','sa@test'),(3,'Student B','sb@test'),(4,'Teacher B','tb@test');
 INSERT INTO classes VALUES(10,'school-a',1),(11,'school-b',4);
 INSERT INTO enrollments VALUES(1,10,2),(2,10,3);
 INSERT INTO attendance VALUES(1,10,2,'2026-11-26','absent'),(2,10,3,'2026-11-25','late');
 `);
 return {database,repository:createAttendanceRepository(database)};
}
test("admin, assigned teacher and enrolled student can read class attendance",async()=>{
 const {database,repository}=setup();try{
  const admin=await repository.listForClass(99,"school-a","school_admin",10,"2026-11-26");
  const teacher=await repository.listForClass(1,"school-a","teacher",10,"2026-11-26");
  const student=await repository.listForClass(2,"school-a","student",10,"2026-11-26");
  assert.equal(admin.length,2);assert.equal(teacher.length,2);assert.equal(student.length,2);
  assert.equal(admin[0].status,"absent");
 }finally{await database.close();}
});
test("cross-school and unassigned teacher access are denied",async()=>{
 const {database,repository}=setup();try{
  assert.equal(await repository.listForClass(1,"school-a","teacher",11,"2026-11-26"),null);
  assert.equal(await repository.listForClass(2,"school-b","student",10,"2026-11-26"),null);
  assert.equal(await repository.summarizeClass(4,"school-b","teacher",10),null);
 }finally{await database.close();}
});
test("attendance summary returns per-student counts",async()=>{
 const {database,repository}=setup();try{
  const rows=await repository.summarizeClass(1,"school-a","teacher",10);
  assert.equal(rows.length,2);assert.equal(rows[0].total,1);assert.equal(rows[0].absent,1);
 }finally{await database.close();}
});
test("attendance repository rejects invalid identifiers, role and date",async()=>{
 const {database,repository}=setup();try{
  await assert.rejects(repository.listForClass(0,"school-a","teacher",10,"2026-11-26"),/user ID/);
  await assert.rejects(repository.listForClass(1,"","teacher",10,"2026-11-26"),/institution ID/);
  await assert.rejects(repository.listForClass(1,"school-a","parent",10,"2026-11-26"),/role/);
  await assert.rejects(repository.listForClass(1,"school-a","teacher","bad","2026-11-26"),/class ID/);
  await assert.rejects(repository.listForClass(1,"school-a","teacher",10,"bad-date"),/date/);
 }finally{await database.close();}
});
