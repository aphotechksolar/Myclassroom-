function createGuardianRepository(database) {
 if(!database||typeof database.many!=="function") throw new TypeError("Guardian repository requires an async database");
 function id(value,label){if(!Number.isSafeInteger(Number(value))||Number(value)<=0)throw new TypeError("A valid "+label+" is required");return Number(value);}
 return Object.freeze({
  async listChildren(guardianId,institutionId){
   const requesterId=id(guardianId,"guardian ID");
   if(typeof institutionId!=="string"||!institutionId.trim())throw new TypeError("A valid institution ID is required");
   return database.many(`SELECT u.id,u.name,
    (SELECT GROUP_CONCAT(c.name, ', ') FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=u.id AND c.institution_id=$1) class_names
    FROM guardian_student_links l JOIN users u ON u.id=l.student_id
    JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=l.institution_id AND m.role='student' AND m.status='active'
    WHERE l.institution_id=$1 AND l.guardian_id=$2 AND l.status='verified' ORDER BY u.name`,
    [institutionId,requesterId]);
  }
 });
}
module.exports={createGuardianRepository};
