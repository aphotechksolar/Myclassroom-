function createRankingsRepository(database) {
  if (!database || typeof database.one!=="function" || typeof database.many!=="function") {
    throw new TypeError("Rankings repository requires an async database");
  }
  function validId(value,label) {
    if (!Number.isSafeInteger(Number(value)) || Number(value)<=0) throw new TypeError("A valid "+label+" is required");
    return Number(value);
  }
  return Object.freeze({
    async listForClass(userId,institutionId,role,classId) {
      const requesterId=validId(userId,"user ID");
      if(typeof institutionId!=="string" || !institutionId.trim()) throw new TypeError("A valid institution ID is required");
      const targetClassId=validId(classId,"class ID");
      if(!["school_admin","teacher","student"].includes(role)) {
        const error=new Error("Not allowed");error.status=403;throw error;
      }
      const targetClass=await database.one(
        "SELECT id,teacher_id FROM classes WHERE id=$1 AND institution_id=$2",
        [targetClassId,institutionId]
      );
      if(!targetClass) return null;
      if(role==="teacher" && Number(targetClass.teacher_id)!==requesterId) return null;
      if(role==="student") {
        const enrolled=await database.one(
          "SELECT 1 AS allowed FROM enrollments WHERE class_id=$1 AND student_id=$2 LIMIT 1",
          [targetClassId,requesterId]
        );
        if(!enrolled) return null;
      }
      const rows=await database.many(
        `SELECT u.id,u.name,ROUND(COALESCE(AVG(at.percentage),0),1) average
         FROM users u
         JOIN enrollments e ON e.student_id=u.id AND e.class_id=$1
         JOIN institution_memberships m ON m.user_id=u.id
          AND m.institution_id=$2 AND m.role='student' AND m.status='active'
         LEFT JOIN assessments a ON a.class_id=e.class_id
         LEFT JOIN attempts at ON at.assessment_id=a.id AND at.student_id=u.id AND at.status='submitted'
         GROUP BY u.id
         ORDER BY average DESC,u.name`,
        [targetClassId,institutionId]
      );
      return rows;
    }
  });
}
module.exports={createRankingsRepository};
