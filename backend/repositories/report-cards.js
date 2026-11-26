function createReportCardRepository(database) {
  if(!database || typeof database.one!=="function" || typeof database.many!=="function") {
    throw new TypeError("Report card repository requires an async database");
  }
  function id(value,label) {
    if(!Number.isSafeInteger(Number(value)) || Number(value)<=0) throw new TypeError("A valid "+label+" is required");
    return Number(value);
  }
  return Object.freeze({
    async getForUser(userId,institutionId,role,studentId,institutionName) {
      const requesterId=id(userId,"user ID");
      const targetId=id(studentId,"student ID");
      if(typeof institutionId!=="string" || !institutionId.trim()) throw new TypeError("A valid institution ID is required");
      if(!["school_admin","teacher","student"].includes(role)) {
        const error=new Error("Not allowed");error.status=403;throw error;
      }
      if(role==="student" && requesterId!==targetId) {
        const error=new Error("Not allowed");error.status=403;throw error;
      }
      const student=await database.one(
        `SELECT u.id,u.name,u.email FROM users u
         JOIN institution_memberships m ON m.user_id=u.id
         WHERE u.id=$1 AND m.institution_id=$2 AND m.status='active' AND m.role='student'`,
        [targetId,institutionId]
      );
      if(!student) {
        const error=new Error("Student not found in this school");error.status=404;throw error;
      }
      if(role==="teacher") {
        const assigned=await database.one(
          `SELECT 1 AS allowed FROM enrollments e JOIN classes c ON c.id=e.class_id
           WHERE e.student_id=$1 AND c.teacher_id=$2 AND c.institution_id=$3 LIMIT 1`,
          [targetId,requesterId,institutionId]
        );
        if(!assigned) {
          const error=new Error("Not allowed");error.status=403;throw error;
        }
      }
      const subjects=await database.many(
        `SELECT s.name subject,ROUND(COALESCE(AVG(at.percentage),0),1) average
         FROM subjects s JOIN classes c ON c.id=s.class_id
         JOIN enrollments e ON e.class_id=s.class_id AND e.student_id=$1
         LEFT JOIN assessments a ON a.class_id=s.class_id
         LEFT JOIN attempts at ON at.assessment_id=a.id AND at.student_id=$1 AND at.status='submitted'
         WHERE c.institution_id=$2
         GROUP BY s.id ORDER BY s.name`,
        [targetId,institutionId]
      );
      const attendance=await database.one(
        `SELECT COUNT(*) total,SUM(att.status='present') present,
         SUM(att.status='absent') absent,SUM(att.status='late') late
         FROM attendance att JOIN classes c ON c.id=att.class_id
         WHERE att.student_id=$1 AND c.institution_id=$2`,
        [targetId,institutionId]
      );
      const setting=await database.one(
        "SELECT value FROM institution_settings WHERE key='school_name' AND institution_id=$1",
        [institutionId]
      );
      return {
        school:setting?.value||institutionName||"MyClassroom Academy",
        student,subjects,attendance
      };
    }
  });
}
module.exports={createReportCardRepository};
