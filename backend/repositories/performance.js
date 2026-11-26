function createPerformanceRepository(database) {
  if (!database || typeof database.one !== "function" || typeof database.many !== "function") throw new TypeError("Performance repository requires an async database");
  function validId(value,label) {
    if (!Number.isSafeInteger(Number(value)) || Number(value)<=0) throw new TypeError("A valid "+label+" is required");
    return Number(value);
  }
  function validInstitution(value) {
    if (typeof value!=="string" || !value.trim()) throw new TypeError("A valid institution ID is required");
  }
  return Object.freeze({
    async getForUser(userId,institutionId,role,studentId) {
      const requesterId=validId(userId,"user ID"); validInstitution(institutionId);
      if (!["school_admin","teacher","student"].includes(role)) { const error=new Error("Not allowed");error.status=403;throw error; }
      const targetId=role==="student"?requesterId:validId(studentId,"student ID");
      const student=await database.one(
        `SELECT u.id,u.name,u.email FROM users u JOIN institution_memberships m ON m.user_id=u.id
         WHERE u.id=$1 AND u.role='student' AND m.institution_id=$2 AND m.role='student' AND m.status='active'`,
        [targetId,institutionId]
      );
      if(!student) return null;
      if(role==="teacher") {
        const assigned=await database.one(
          `SELECT 1 AS allowed FROM enrollments e JOIN classes c ON c.id=e.class_id
           WHERE e.student_id=$1 AND c.teacher_id=$2 AND c.institution_id=$3 LIMIT 1`,
          [targetId,requesterId,institutionId]
        );
        if(!assigned) { const error=new Error("Not allowed");error.status=403;throw error; }
      }
      const results=await database.many(
        `SELECT a.title,a.type,at.percentage,at.status,at.submitted_at
         FROM attempts at JOIN assessments a ON a.id=at.assessment_id JOIN classes c ON c.id=a.class_id
         WHERE at.student_id=$1 AND c.institution_id=$2 AND at.status='submitted' ORDER BY at.id`,
        [targetId,institutionId]
      );
      const attendance=await database.many(
        `SELECT att.status,COUNT(*) c FROM attendance att JOIN classes c ON c.id=att.class_id
         WHERE att.student_id=$1 AND c.institution_id=$2 GROUP BY att.status`,
        [targetId,institutionId]
      );
      return {student,results,attendance};
    }
  });
}
module.exports={createPerformanceRepository};
