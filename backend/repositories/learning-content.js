/**
 * Institution-scoped reads for learning materials and assignments.
 * Visibility mirrors the existing API: students see enrolled classes,
 * teachers see content they own or content in classes they teach, and
 * school admins see all content in their institution.
 */
function createLearningContentRepository(database) {
  if (!database || typeof database.many !== "function") {
    throw new TypeError("Learning content repository requires an async database");
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

  function buildVisibility(role, userId, classAlias, contentAlias) {
    if (role === "student") {
      return {
        join: ` JOIN enrollments e ON e.class_id = ${contentAlias}.class_id AND e.student_id = $2`,
        where: "",
        params: [userId]
      };
    }
    if (role === "teacher") {
      return {
        join: "",
        where: ` AND (${contentAlias}.teacher_id = $2 OR ${classAlias}.teacher_id = $2)`,
        params: [userId]
      };
    }
    return { join: "", where: "", params: [] };
  }

  return Object.freeze({
    async listMaterialsForUser(userId, institutionId, role) {
      const id = validateScope(userId, institutionId, role);
      const visibility = buildVisibility(role, id, "c", "m");
      return database.many(
        `SELECT m.*, c.name class_name, u.name teacher_name
         FROM materials m
         LEFT JOIN classes c ON c.id = m.class_id
         LEFT JOIN users u ON u.id = m.teacher_id
         ${visibility.join}
         WHERE c.institution_id = $1${visibility.where}
         ORDER BY m.id DESC`,
        [institutionId, ...visibility.params]
      );
    },

    async listAssignmentsForUser(userId, institutionId, role) {
      const id = validateScope(userId, institutionId, role);
      const visibility = buildVisibility(role, id, "c", "a");
      return database.many(
        `SELECT a.*, c.name class_name, u.name teacher_name
         FROM assignments a
         LEFT JOIN classes c ON c.id = a.class_id
         LEFT JOIN users u ON u.id = a.teacher_id
         ${visibility.join}
         WHERE c.institution_id = $1${visibility.where}
         ORDER BY a.due_date`,
        [institutionId, ...visibility.params]
      );
    }
  });
}

module.exports = { createLearningContentRepository };
