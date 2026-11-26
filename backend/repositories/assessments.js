/**
 * Institution-scoped assessment listing.
 * Students see enrolled classes; teachers see assessments they own or teach;
 * school admins see all assessments in their institution.
 */
function createAssessmentsRepository(database) {
  if (!database || typeof database.many !== "function") {
    throw new TypeError("Assessments repository requires an async database");
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
      let visibility = "";
      const params = [institutionId];
      if (role === "student") {
        visibility = " JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = $2";
        params.push(id);
      } else if (role === "teacher") {
        visibility = " AND (a.teacher_id = $2 OR c.teacher_id = $2)";
        params.push(id);
      }

      const rows = await database.many(
        `SELECT a.*, c.name class_name, u.name teacher_name
         FROM assessments a
         JOIN classes c ON c.id = a.class_id
         LEFT JOIN users u ON u.id = a.teacher_id
         ${role === "student" ? visibility : ""}
         WHERE c.institution_id = $1${role === "teacher" ? visibility : ""}
         ORDER BY a.id DESC`,
        params
      );
      return rows.map(row => ({
        ...row,
        question_count: JSON.parse(row.questions_json).length
      }));
    }
  });
}

module.exports = { createAssessmentsRepository };
