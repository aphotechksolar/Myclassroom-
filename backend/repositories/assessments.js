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

  function normalizeQuestions(raw) {
    if (!Array.isArray(raw)) throw new TypeError("Questions must be an array");
    return raw.map((question, index) => ({
      question: String(question.question || "Question " + (index + 1)),
      options: Array.isArray(question.options) ? question.options.map(String) : [],
      answer: Number(question.answer || 0)
    })).filter(question =>
      question.options.length >= 2 &&
      question.answer >= 0 &&
      question.answer < question.options.length
    );
  }

  async function createForClass(input) {
    const id = validateScope(input.userId, input.institutionId, input.role);
    if (!["school_admin", "teacher"].includes(input.role)) {
      throw new TypeError("Only school admins and teachers can create assessments");
    }
    if (!Number.isSafeInteger(Number(input.classId)) || Number(input.classId) <= 0) {
      throw new TypeError("A valid class ID is required");
    }

    const questions = normalizeQuestions(input.questions);
    if (!questions.length) {
      throw new TypeError("Add at least one valid question");
    }

    return database.transaction(async (tx) => {
      const schoolClass = await tx.one(
        "SELECT id, teacher_id FROM classes WHERE id = $1 AND institution_id = $2",
        [Number(input.classId), input.institutionId]
      );
      if (!schoolClass || (input.role === "teacher" && Number(schoolClass.teacher_id) !== id)) {
        const error = new Error("Not allowed");
        error.status = 403;
        throw error;
      }

      const title = input.title;
      const type = input.type || "quiz";
      const duration = Number(input.durationMinutes || 20);
      const passMark = Number(input.passMark || 50);
      const inserted = await tx.execute(
        "INSERT INTO assessments(title, type, duration_minutes, class_id, teacher_id, pass_mark, questions_json) VALUES($1, $2, $3, $4, $5, $6, $7)",
        [title, type, duration, Number(input.classId), id, passMark, JSON.stringify(questions)]
      );
      const students = await tx.many(
        "SELECT student_id FROM enrollments WHERE class_id = $1",
        [Number(input.classId)]
      );
      return {
        id: inserted.insertId,
        studentIds: students.map(student => Number(student.student_id))
      };
    });
  }

  return Object.freeze({
    async createForClass(input) { return createForClass(input); },

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
