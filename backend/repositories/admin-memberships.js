function createAdminMembershipRepository(database) {
 if(!database||typeof database.transaction!=="function") throw new TypeError("Admin membership repository requires an async database");
 function positiveId(value,label){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new TypeError("A valid "+label+" is required");return n;}
 return Object.freeze({
  async removeFromInstitution(institutionId,userId){
   if(typeof institutionId!=="string"||!institutionId.trim())throw new TypeError("A valid institution ID is required");
   const targetId=positiveId(userId,"user ID");
   return database.transaction(async tx=>{
    const existing=await tx.one("SELECT user_id FROM institution_memberships WHERE institution_id=$1 AND user_id=$2",[institutionId,targetId]);
    if(!existing)return false;
    await tx.execute("DELETE FROM institution_memberships WHERE institution_id=$1 AND user_id=$2",[institutionId,targetId]);
    return true;
   });
  }
 });
}
module.exports={createAdminMembershipRepository};
