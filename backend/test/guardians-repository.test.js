const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createGuardianRepository}=require("../repositories/guardians");
function setup(){
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 sqlite.exec(`
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT);
 CREATE TABLE institution_memberships(id INTEGER PRIMARY KEY,institution_id TEXT,user_id INTEGER,role TEXT,status TEXT);
 CREATE TABLE classes(id INTEGER PRIMARY KEY,institution_id TEXT,name TEXT);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER,student_id INTEGER);
 CREATE TABLE guardian_student_links(id INTEGER PRIMARY KEY,institution_id TEXT,guardian_id INTEGER,student_id INTEGER,status TEXT);
 INSERT INTO users VALUES (1,'Guardian A','ga@test'),(2,'Guardian B','gb@test'),(10,'Student A','sa@test'),(11,'Student B','sb@test'),(12,'Other School Student','os@test'),(13,'Suspended Student','ss@test');
 INSERT INTO institution_memberships VALUES (1,'school-a',1,'parent','active'),(2,'school-a',2,'parent','active'),(3,'school-a',10,'student','active'),(4,'school-a',11,'student','active'),(5,'school-b',12,'student','active'),(6,'school-a',13,'student','suspended');
 INSERT INTO classes VALUES (20,'school-a','Primary 1'),(21,'school-a','Primary 2'),(22,'school-b','Other Class');
 INSERT INTO enrollments VALUES (1,20,10),(2,21,10),(3,21,11),(4,22,12);
 INSERT INTO guardian_student_links VALUES (1,'school-a',1,10,'verified'),(2,'school-a',1,11,'pending'),(3,'school-a',1,12,'verified'),(4,'school-a',1,13,'verified'),(5,'school-a',2,11,'verified');
 `);
 return {database,repository:createGuardianRepository(database)};
}
test("guardian sees only verified children with active student membership in the same school",async()=>{const {database,repository}=setup();try{const rows=await repository.listChildren(1,"school-a");assert.deepEqual(rows.map(row=>row.id),[10]);assert.equal(rows[0].class_names,"Primary 1, Primary 2");}finally{await database.close();}});
test("guardian child list is scoped to the requesting guardian",async()=>{const {database,repository}=setup();try{const rows=await repository.listChildren(2,"school-a");assert.deepEqual(rows.map(row=>row.id),[11]);}finally{await database.close();}});
test("guardian child list rejects invalid guardian or institution scope",async()=>{const {database,repository}=setup();try{await assert.rejects(repository.listChildren(0,"school-a"),/valid guardian ID/);await assert.rejects(repository.listChildren(1,""),/valid institution ID/);}finally{await database.close();}});
