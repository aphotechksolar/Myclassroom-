function createGradebookRepository(database) {
  if (!database || typeof database.many !== "function") throw new TypeError("Gradebook repository requires an async database");
  function validateScope(userId, institutionId, role) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new TypeError("A valid user ID is required");
    if (typeof institutionId !== "string" || !institutionId.trim()) throw new TypeError("A valid institution ID is required");
    if (!["school_admin", "teacher"].includes(role)) throw new TypeError("Only school admins and teachers can access the gradebook");
    return Number(userId);
  }
  return Object.freeze({
    async listForUser(userId, institutionId, role) {
      const id=validateScope(userId,institutionId,role);
      const teacherFilter=role==="teacher" ? " AND c.teacher_id = $3" : "";
      const params=role==="teacher" ? [institutionId,institutionId,id] : [institutionId,institutionId];
      return database.many(
        `SELECT u.id student_id,u.name student_name,c.id class_id,c.name class_name,
         (SELECT ROUND(AVG(at.percentage),1) FROM attempts at JOIN assessments aa ON aa.id=at.assessment_id
          WHERE at.student_id=u.id AND aa.class_id=c.id AND at.status='submitted') assessment_average,
         (SELECT ROUND(AVG(s.score*100.0/a.max_score),1) FROM submissions s JOIN assignments a ON a.id=s.assignment_id
          WHERE s.student_id=u.id AND a.class_id=c.id AND s.score IS NOT NULL) assignment_average
         FROM users u JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id
         JOIN institution_memberships m ON m.user_id=u.id AND m.institution_id=$1 AND m.status='active'
         WHERE u.role='student' AND c.institution_id=$2${teacherFilter} ORDER BY c.name,u.name`,
        params
      );
    }
  });
}
module.exports={createGradebookRepository};
