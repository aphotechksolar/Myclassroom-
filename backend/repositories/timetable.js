function createTimetableRepository(database) {
  if (!database || typeof database.many !== "function" || typeof database.transaction !== "function") {
    throw new TypeError("Timetable repository requires an async database");
  }
  function validateScope(userId, institutionId, role) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("A valid user ID is required");
    if (typeof institutionId !== "string" || !institutionId.trim()) throw new TypeError("A valid institution ID is required");
    if (!["school_admin", "teacher", "student"].includes(role)) throw new TypeError("A valid institution role is required");
    return id;
  }
  return Object.freeze({
    async listForUser(userId, institutionId, role) {
      const id = validateScope(userId, institutionId, role);
      const base = "SELECT t.*,c.name class_name,s.name subject_name FROM timetable t JOIN classes c ON c.id=t.class_id LEFT JOIN subjects s ON s.id=t.subject_id WHERE c.institution_id=$1";
      const order = " ORDER BY CASE t.day WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 ELSE 7 END,t.start_time";
      if (role === "student") return database.many(base + " AND EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id=c.id AND e.student_id=$2)" + order, [institutionId,id]);
      if (role === "teacher") return database.many(base + " AND (c.teacher_id=$2 OR s.teacher_id=$2)" + order, [institutionId,id]);
      return database.many(base + order, [institutionId]);
    },
    async create(input) {
      const userId = validateScope(input.userId,input.institutionId,input.role);
      if (!["school_admin","teacher"].includes(input.role)) throw new TypeError("Only school administrators and teachers can create timetable entries");
      const classId = Number(input.classId);
      if (!Number.isSafeInteger(classId) || classId <= 0) throw new TypeError("A valid class is required");
      const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
      const day = typeof input.day === "string" ? days.find(x => x.toLowerCase() === input.day.trim().toLowerCase()) : null;
      if (!day) throw new TypeError("Choose a valid day of the week");
      const startTime = typeof input.startTime === "string" ? input.startTime.trim() : "";
      const endTime = typeof input.endTime === "string" ? input.endTime.trim() : "";
      if (!startTime || startTime.length > 30 || !endTime || endTime.length > 30) throw new TypeError("Start and end times are required");
      const room = input.room == null ? "" : String(input.room).trim();
      if (room.length > 120) throw new TypeError("Room must be 120 characters or fewer");
      const subjectId = input.subjectId == null || input.subjectId === "" ? null : Number(input.subjectId);
      if (subjectId !== null && (!Number.isSafeInteger(subjectId) || subjectId <= 0)) throw new TypeError("A valid subject is required");
      return database.transaction(async tx => {
        const classroom = await tx.one("SELECT id,teacher_id FROM classes WHERE id=$1 AND institution_id=$2",[classId,input.institutionId]);
        if (!classroom) throw new Error("Class not found in this school");
        if (input.role === "teacher" && Number(classroom.teacher_id) !== userId) throw new Error("Teachers can only add timetable entries for their assigned classes");
        if (subjectId !== null && !await tx.one("SELECT id FROM subjects WHERE id=$1 AND class_id=$2",[subjectId,classId])) throw new Error("Subject must belong to this class");
        const result = await tx.execute("INSERT INTO timetable(class_id,subject_id,day,start_time,end_time,room) VALUES($1,$2,$3,$4,$5,$6)",[classId,subjectId,day,startTime,endTime,room]);
        return { id: result.insertId };
      });
    }
  });
}
module.exports = { createTimetableRepository };
