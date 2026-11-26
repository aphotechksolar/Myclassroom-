function createAuditRepository(database) {
 if(!database||typeof database.many!=="function") throw new TypeError("Audit repository requires an async database");
 return Object.freeze({
  async listForInstitution(institutionId) {
   if(typeof institutionId!=="string"||!institutionId.trim()) throw new TypeError("A valid institution ID is required");
   return database.many(`SELECT a.*,u.name actor_name FROM audit_log a
    LEFT JOIN users u ON u.id=a.actor_id
    WHERE a.institution_id=$1 ORDER BY a.id DESC LIMIT 100`,[institutionId]);
  }
 });
}
module.exports={createAuditRepository};
