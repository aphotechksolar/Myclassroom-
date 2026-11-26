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
  },
  async getChildPerformance(guardianId,institutionId,studentId){
   const requesterId=id(guardianId,"guardian ID");
   const childId=id(studentId,"student ID");
   if(typeof institutionId!=="string"||!institutionId.trim())throw new TypeError("A valid institution ID is required");
   const link=await database.one(`SELECT 1 AS verified FROM guardian_student_links l
    JOIN institution_memberships m ON m.user_id=l.student_id AND m.institution_id=l.institution_id
      AND m.role='student' AND m.status='active'
    WHERE l.institution_id=$1 AND l.guardian_id=$2 AND l.student_id=$3 AND l.status='verified'`,
    [institutionId,requesterId,childId]);
   if(!link)return null;
   const student=await database.one("SELECT id,name FROM users WHERE id=$1",[childId]);
   if(!student)return null;
   const results=await database.many(`SELECT a.title,a.type,at.percentage,at.status,at.submitted_at
    FROM attempts at JOIN assessments a ON a.id=at.assessment_id JOIN classes c ON c.id=a.class_id
    WHERE at.student_id=$1 AND c.institution_id=$2 AND at.status IN ('submitted','expired')
    ORDER BY at.id DESC LIMIT 100`,[childId,institutionId]);
   const attendance=await database.many(`SELECT att.status,COUNT(*) count FROM attendance att
    JOIN classes c ON c.id=att.class_id WHERE att.student_id=$1 AND c.institution_id=$2
    GROUP BY att.status`,[childId,institutionId]);
   const assignments=await database.many(`SELECT a.title,a.due_date,s.score,s.feedback,s.submitted_at
    FROM assignments a JOIN classes c ON c.id=a.class_id
    LEFT JOIN submissions s ON s.assignment_id=a.id AND s.student_id=$1
    JOIN enrollments e ON e.class_id=c.id AND e.student_id=$1
    WHERE c.institution_id=$2 ORDER BY a.due_date DESC LIMIT 100`,[childId,institutionId]);
   return {student,results,attendance,assignments};
  }
 });
}
module.exports={createGuardianRepository};
