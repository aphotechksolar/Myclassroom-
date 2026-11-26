function createPeopleRepository(database) {
  if (!database || typeof database.many !== "function") throw new TypeError("People repository requires an async database");
  function validInstitution(id) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A valid institution ID is required");
  }
  function validUser(id) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new TypeError("A valid user ID is required");
    return Number(id);
  }
  return Object.freeze({
    async listStudentsForUser(userId, institutionId, role) {
      const id = validUser(userId); validInstitution(institutionId);
      if (!["school_admin","teacher"].includes(role)) throw new TypeError("A valid directory role is required");
      if (role === "school_admin") return database.many(
        `SELECT u.id,u.name,u.email,u.phone,u.bio FROM users u
         JOIN institution_memberships m ON m.user_id=u.id
         WHERE m.institution_id=$1 AND m.role='student' AND m.status='active' ORDER BY u.name`,
        [institutionId]
      );
      return database.many(
        `SELECT DISTINCT u.id,u.name,u.email,u.phone,u.bio FROM users u
         JOIN institution_memberships m ON m.user_id=u.id
         JOIN enrollments e ON e.student_id=u.id JOIN classes c ON c.id=e.class_id
         WHERE m.institution_id=$1 AND m.status='active' AND m.role='student'
           AND c.institution_id=$1 AND c.teacher_id=$2 ORDER BY u.name`,
        [institutionId,id]
      );
    },
    async listTeachersForInstitution(institutionId, role) {
      validInstitution(institutionId);
      if (role !== "school_admin") throw new TypeError("Only a school administrator can list teachers");
      return database.many(
        `SELECT u.id,u.name,u.email,u.phone,u.bio FROM users u
         JOIN institution_memberships m ON m.user_id=u.id
         WHERE m.institution_id=$1 AND m.role='teacher' AND m.status='active' ORDER BY u.name`,
        [institutionId]
      );
    }
  });
}
module.exports = { createPeopleRepository };
