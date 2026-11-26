/**
 * Institution-scoped class and subject reads.
 *
 * User and institution identifiers are supplied by authenticated membership
 * context. Visibility is additionally restricted by the user's institution role.
 */
function createClassesRepository(database) {
  if (!database || typeof database.many !== "function") {
    throw new TypeError("Classes repository requires an async database");
  }

  function validateScope(userId, institutionId, role) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      throw new TypeError("A valid user ID is required");
    }
    if (typeof institutionId !== "string" || !institutionId.trim()) {
      throw new TypeError("A valid institution ID is required");
    }
    if (!["school_admin", "teacher", "student"].includes(role)) {
      throw new TypeError("A valid institution role is required");
    }
    return Number(userId);
  }

  return Object.freeze({
    async listForUser(userId, institutionId, role) {
      const id = validateScope(userId, institutionId, role);
      if (role === "student") {
        return database.many(
          `SELECT c.*, u.name teacher_name
           FROM classes c
           JOIN enrollments e ON e.class_id = c.id AND e.student_id = $2
           LEFT JOIN users u ON u.id = c.teacher_id
           WHERE c.institution_id = $1
           ORDER BY c.name`,
          [institutionId, id]
        );
      }

      const teacherFilter = role === "teacher" ? " AND c.teacher_id = $2" : "";
      const params = role === "teacher" ? [institutionId, id] : [institutionId];
      return database.many(
        `SELECT c.*, u.name teacher_name,
                (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id) student_count
         FROM classes c
         LEFT JOIN users u ON u.id = c.teacher_id
         WHERE c.institution_id = $1${teacherFilter}
         ORDER BY c.name`,
        params
      );
    },

    async listSubjectsForUser(userId, institutionId, role) {
      const id = validateScope(userId, institutionId, role);
      if (role === "student") {
        return database.many(
          `SELECT s.*, c.name class_name
           FROM subjects s
           JOIN classes c ON c.id = s.class_id AND c.institution_id = $1
           JOIN enrollments e ON e.class_id = s.class_id AND e.student_id = $2
           ORDER BY s.name`,
          [institutionId, id]
        );
      }
      if (role === "teacher") {
        return database.many(
          `SELECT s.*, c.name class_name
           FROM subjects s
           JOIN classes c ON c.id = s.class_id AND c.institution_id = $1
           WHERE s.teacher_id = $2 OR c.teacher_id = $2
           ORDER BY s.name`,
          [institutionId, id]
        );
      }
      return database.many(
        `SELECT s.*, c.name class_name
         FROM subjects s
         JOIN classes c ON c.id = s.class_id AND c.institution_id = $1
         ORDER BY s.name`,
        [institutionId]
      );
    }
  });
}

module.exports = { createClassesRepository };
