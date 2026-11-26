function createAttendanceRepository(database) {
  if (!database || typeof database.many !== "function") throw new TypeError("Attendance repository requires an async database");
  function scope(userId,institutionId,role,classId) {
    const user=Number(userId), klass=Number(classId);
    if (!Number.isSafeInteger(user)||user<=0) throw new TypeError("A valid user ID is required");
    if (typeof institutionId!=="string"||!institutionId.trim()) throw new TypeError("A valid institution ID is required");
    if (!Number.isSafeInteger(klass)||klass<=0) throw new TypeError("A valid class ID is required");
    if (!["school_admin","teacher","student"].includes(role)) throw new TypeError("A valid role is required");
    return {user,klass};
  }
  async function canView(user,institutionId,role,klass) {
    const rows=await database.many(
      `SELECT c.id FROM classes c
       WHERE c.id=$1 AND c.institution_id=$2
       AND ( $3='school_admin'
         OR ($3='teacher' AND c.teacher_id=$4)
         OR ($3='student' AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id=c.id AND e.student_id=$4)) )`,
      [klass,institutionId,role,user]
    );
    return rows.length===1;
  }
  return Object.freeze({
    async listForClass(userId,institutionId,role,classId,date) {
      const {user,klass}=scope(userId,institutionId,role,classId);
      if (typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError("A valid attendance date is required");
      if (!await canView(user,institutionId,role,klass)) return null;
      return database.many(
        `SELECT u.id,u.name,u.email,COALESCE(att.status,'present') status
         FROM users u JOIN enrollments e ON e.student_id=u.id
         LEFT JOIN attendance att ON att.student_id=u.id AND att.class_id=e.class_id AND att.date=$1
         WHERE e.class_id=$2 ORDER BY u.name`,
        [date,klass]
      );
    },
    async summarizeClass(userId,institutionId,role,classId) {
      const {user,klass}=scope(userId,institutionId,role,classId);
      if (!await canView(user,institutionId,role,klass)) return null;
      return database.many(
        `SELECT u.id,u.name,COUNT(att.id) total,
          SUM(CASE WHEN att.status='present' THEN 1 ELSE 0 END) present,
          SUM(CASE WHEN att.status='absent' THEN 1 ELSE 0 END) absent,
          SUM(CASE WHEN att.status='late' THEN 1 ELSE 0 END) late
         FROM users u JOIN enrollments e ON e.student_id=u.id
         LEFT JOIN attendance att ON att.student_id=u.id AND att.class_id=e.class_id
         WHERE e.class_id=$1 GROUP BY u.id ORDER BY u.name`,
        [klass]
      );
    }
  });
}
module.exports={createAttendanceRepository};
