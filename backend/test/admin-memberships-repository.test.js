const test=require("node:test");
const assert=require("node:assert/strict");
const {createDatabase}=require("../db");
const {openAsyncSqliteDatabase}=require("../db/sqlite-async");
const {createAdminMembershipRepository}=require("../repositories/admin-memberships");
test("membership removal deletes only the selected institution membership",async()=>{
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 try{
  sqlite.exec(`CREATE TABLE institution_memberships(institution_id TEXT,user_id INTEGER,role TEXT,status TEXT,PRIMARY KEY(institution_id,user_id));
   INSERT INTO institution_memberships VALUES('school-a',7,'teacher','active'),('school-b',7,'teacher','active');`);
  const repository=createAdminMembershipRepository(database);
  assert.equal(await repository.removeFromInstitution("school-a",7),true);
  assert.equal(await database.one("SELECT user_id FROM institution_memberships WHERE institution_id=$1 AND user_id=$2",["school-a",7]),null);
  assert.deepEqual(await database.one("SELECT user_id,role,status FROM institution_memberships WHERE institution_id=$1 AND user_id=$2",["school-b",7]),{user_id:7,role:"teacher",status:"active"});
 }finally{await database.close();}
});
test("membership removal returns false when user is not a member of that school",async()=>{
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 try{sqlite.exec("CREATE TABLE institution_memberships(institution_id TEXT,user_id INTEGER,PRIMARY KEY(institution_id,user_id))");
 const repository=createAdminMembershipRepository(database);assert.equal(await repository.removeFromInstitution("school-a",9),false);
 }finally{await database.close();}
});
test("membership removal validates institution and user identifiers",async()=>{
 const sqlite=createDatabase(":memory:"),database=openAsyncSqliteDatabase(sqlite);
 try{const repository=createAdminMembershipRepository(database);
 await assert.rejects(repository.removeFromInstitution("",1),/valid institution ID/);
 await assert.rejects(repository.removeFromInstitution("school-a","bad"),/valid user ID/);
 }finally{await database.close();}
});
