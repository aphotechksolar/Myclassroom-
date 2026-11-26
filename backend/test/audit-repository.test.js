const test=require("node:test");
const assert=require("node:assert/strict");
const {createAuditRepository}=require("../repositories/audit");
test("audit listing is institution scoped, newest first and capped at 100",async()=>{
 let sql,args;
 const rows=Array.from({length:100},(_,i)=>({id:100-i,institution_id:"school-a"}));
 const repository=createAuditRepository({many:async(q,p)=>{sql=q;args=p;return rows;}});
 const result=await repository.listForInstitution("school-a");
 assert.equal(result.length,100);assert.deepEqual(args,["school-a"]);
 assert.match(sql,/WHERE a\.institution_id=\$1 ORDER BY a\.id DESC LIMIT 100/);
});
test("audit listing rejects an empty institution scope",async()=>{
 const repository=createAuditRepository({many:async()=>[]});
 await assert.rejects(repository.listForInstitution(" "),/valid institution ID/);
});
test("audit repository requires async database",()=>{
 assert.throws(()=>createAuditRepository({}),/async database/);
});
