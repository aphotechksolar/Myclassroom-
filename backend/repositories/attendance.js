function createAttendanceRepository(database) {
  if (!database || typeof database.many !== "function" || typeof database.transaction !== "function") {
    throw new TypeError("Attendance repository requires an async database");
  }
  function scope(userId,institutionId,role,classId) {
    const user=Number(userId), klass=Number(classId);
    if (!Number.isSafeInteger(user)||user<=0) throw new TypeError("A valid user ID is required");
    if (typeof institutionId!=="string"||!institutionId.trim()) throw new TypeError("A valid institution ID is required");
    if (!Number.isSafeInteger(klass)||klass<=0) throw new TypeError("A valid class ID is required");
    if (!["school_admin","teacher","student"].includes(role)) throw new TypeError("A valid role is required");
    return {user,klass};
  }
  function validDate(date) {
    if (typeof date!=="string"||! /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return false;
    const parsed=new Date(date+"T00:00:00.000Z");
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
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
      if (!validDate(date)) throw new TypeError("A valid attendance date is required");
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
    },
    async recordForClass(input) {
      const {user,klass}=scope(input.userId,input.institutionId,input.role,input.classId);
      if (!["school_admin","teacher"].includes(input.role)) {
        const error=new TypeError("Only school admins and assigned teachers can record attendance"); error.status=403; throw error;
      }
      const student=Number(input.studentId);
      if (!Number.isSafeInteger(student)||student<=0) {
        const error=new TypeError("A valid student ID is required"); error.status=400; throw error;
      }
      if (!validDate(input.date)) {
        const error=new TypeError("A valid attendance date is required"); error.status=400; throw error;
      }
      const status=input.status==null||input.status===""?"present":String(input.status).trim().toLowerCase();
      if (!["present","absent","late"].includes(status)) {
        const error=new TypeError("Attendance status must be present, absent or late"); error.status=400; throw error;
      }
      return database.transaction(async tx=>{
        const classroom=await tx.one("SELECT id,teacher_id FROM classes WHERE id=$1 AND institution_id=$2",[klass,input.institutionId]);
        if (!classroom) return null;
        if (input.role==="teacher"&&Number(classroom.teacher_id)!==user) {
          const error=new Error("Not allowed"); error.status=403; throw error;
        }
        const enrolled=await tx.one(
          `SELECT e.student_id FROM enrollments e
           JOIN institution_memberships m ON m.user_id=e.student_id
           WHERE e.class_id=$1 AND e.student_id=$2 AND m.institution_id=$3
             AND m.role='student' AND m.status='active'`,
          [klass,student,input.institutionId]
        );
        if (!enrolled) {
          const error=new Error("Student is not enrolled in this class"); error.status=400; throw error;
        }
        await tx.execute(
          `INSERT INTO attendance(class_id,student_id,date,status) VALUES($1,$2,$3,$4)
           ON CONFLICT(class_id,student_id,date) DO UPDATE SET status=excluded.status`,
          [klass,student,input.date,status]
        );
        return {ok:true};
      });
    }
  });
}
module.exports={createAttendanceRepository};
