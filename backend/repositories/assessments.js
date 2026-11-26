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
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
      throw new TypeError("An assessment must contain between 1 and 100 questions");
    }
    return raw.map((question, index) => {
      if (!question || typeof question !== "object" || Array.isArray(question)) {
        throw new TypeError("Question " + (index + 1) + " is invalid");
      }
      const prompt = typeof question.question === "string" ? question.question.trim() : "";
      if (!prompt || prompt.length > 2000) {
        throw new TypeError("Question " + (index + 1) + " must contain 1 to 2000 characters");
      }
      if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 10) {
        throw new TypeError("Question " + (index + 1) + " must have between 2 and 10 options");
      }
      const options = question.options.map(option =>
        typeof option === "string" ? option.trim() : ""
      );
      if (options.some(option => !option || option.length > 500)) {
        throw new TypeError("Each option must contain 1 to 500 characters");
      }
      if (new Set(options).size !== options.length) {
        throw new TypeError("Question " + (index + 1) + " cannot contain duplicate options");
      }
      if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= options.length) {
        throw new TypeError("Question " + (index + 1) + " must have a valid correct answer");
      }
      return { question: prompt, options, answer: question.answer };
    });
  }

  function validateAssessmentSettings(input) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > 160) {
      throw new TypeError("Assessment title must contain 1 to 160 characters");
    }
    const duration = input.durationMinutes == null ? 20 : Number(input.durationMinutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 480) {
      throw new TypeError("Assessment duration must be between 1 and 480 minutes");
    }
    const passMark = input.passMark == null ? 50 : Number(input.passMark);
    if (!Number.isFinite(passMark) || passMark < 0 || passMark > 100) {
      throw new TypeError("Pass mark must be between 0 and 100");
    }
    const type = input.type == null ? "quiz" : input.type;
    if (!["quiz", "exam"].includes(type)) {
      throw new TypeError("Assessment type must be quiz or exam");
    }
    return { title, duration, passMark, type };
  }

  function parseAnswers(raw) {
    try {
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function sanitizeAnswers(questions, answers) {
    const safe = {};
    for (const [key, value] of Object.entries(answers)) {
      const questionIndex = Number(key);
      const optionIndex = Number(value);
      if (Number.isInteger(questionIndex) && questionIndex >= 0 && questionIndex < questions.length &&
          Number.isInteger(optionIndex) && optionIndex >= 0 &&
          Array.isArray(questions[questionIndex].options) &&
          optionIndex < questions[questionIndex].options.length) {
        safe[questionIndex] = optionIndex;
      }
    }
    return safe;
  }

  function calculateResult(questions, answers, passMark) {
    let score = 0;
    questions.forEach((question, index) => {
      if (Object.prototype.hasOwnProperty.call(answers, index) &&
          Number(answers[index]) === Number(question.answer)) score++;
    });
    const percentage = questions.length ? Math.round(score / questions.length * 100) : 0;
    return { score, percentage, status: percentage >= Number(passMark) ? "PASS" : "FAIL" };
  }

  async function finalizeTimedOut(tx, attempt, assessment) {
    let questions;
    try { questions = JSON.parse(assessment.questions_json); }
    catch { throw new Error("Assessment questions are unavailable"); }
    const answers = sanitizeAnswers(questions, parseAnswers(attempt.answers_json));
    const result = calculateResult(questions, answers, assessment.pass_mark);
    await tx.execute(
      "UPDATE attempts SET submitted_at = expires_at, score = $1, percentage = $2, status = $3, answers_json = $4 WHERE id = $5 AND student_id = $6 AND submitted_at IS NULL",
      [result.score, result.percentage, result.status, JSON.stringify(answers), attempt.id, attempt.student_id]
    );
    const saved = await tx.one("SELECT * FROM attempts WHERE id = $1 AND student_id = $2", [attempt.id, attempt.student_id]);
    return { ...saved, timed_out: true };
  }

  async function createForClass(input) {
    const id = validateScope(input.userId, input.institutionId, input.role);
    if (!["school_admin", "teacher"].includes(input.role)) {
      throw new TypeError("Only school admins and teachers can create assessments");
    }
    if (!Number.isSafeInteger(Number(input.classId)) || Number(input.classId) <= 0) {
      throw new TypeError("A valid class ID is required");
    }

    const settings = validateAssessmentSettings(input);
    const questions = normalizeQuestions(input.questions);

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

      const inserted = await tx.execute(
        "INSERT INTO assessments(title, type, duration_minutes, class_id, teacher_id, pass_mark, questions_json) VALUES($1, $2, $3, $4, $5, $6, $7)",
        [settings.title, settings.type, settings.duration, Number(input.classId), id, settings.passMark, JSON.stringify(questions)]
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


  async function startAttempt(input) {
    const id = validateScope(input.userId, input.institutionId, "student");
    if (!Number.isSafeInteger(Number(input.assessmentId)) || Number(input.assessmentId) <= 0) {
      throw new TypeError("A valid assessment ID is required");
    }
    const result = await database.transaction(async (tx) => {
      const assessment = await tx.one(
        "SELECT a.id, a.duration_minutes, a.pass_mark, a.questions_json FROM assessments a JOIN classes c ON c.id = a.class_id JOIN enrollments e ON e.class_id = c.id AND e.student_id = $2 WHERE a.id = $1 AND c.institution_id = $3",
        [Number(input.assessmentId), id, input.institutionId]
      );
      if (!assessment) {
        const error = new Error("Not allowed");
        error.status = 403;
        throw error;
      }
      const existing = await tx.one(
        "SELECT * FROM attempts WHERE assessment_id = $1 AND student_id = $2",
        [assessment.id, id]
      );
      if (existing && existing.submitted_at) {
        const timedOut = existing.submitted_at === existing.expires_at;
        const error = new Error(timedOut ? "Assessment time has expired" : "Assessment already submitted");
        error.status = 400;
        error.attempt = { ...existing, timed_out: timedOut };
        throw error;
      }
      let attempt = existing;
      if (attempt && (!attempt.expires_at || !Number.isFinite(Date.parse(attempt.expires_at)))) {
        const error = new Error("This attempt has no valid deadline. Contact your school administrator.");
        error.status = 400;
        throw error;
      }
      if (attempt && Date.parse(attempt.expires_at) <= Date.now()) {
        const expired = await finalizeTimedOut(tx, attempt, assessment);
        return { __expiredAttempt: expired };
      }
      if (!attempt) {
        const duration = Number(assessment.duration_minutes || 20);
        const expiresAt = new Date(Date.now() + duration * 60000).toISOString();
        const inserted = await tx.execute(
          "INSERT INTO attempts(assessment_id, student_id, expires_at) VALUES($1, $2, $3)",
          [assessment.id, id, expiresAt]
        );
        attempt = await tx.one("SELECT * FROM attempts WHERE id = $1", [inserted.insertId]);
      }
      let questions;
      try { questions = JSON.parse(assessment.questions_json); }
      catch { throw new Error("Assessment questions are unavailable"); }
      return {
        attempt,
        questions: questions.map(question => ({
          question: question.question,
          options: question.options
        }))
      };
    });
    if (result && result.__expiredAttempt) {
      const error = new Error("Assessment time has expired");
      error.status = 400;
      error.attempt = result.__expiredAttempt;
      throw error;
    }
    return result;
  }

  async function submitAttempt(input) {
    const id = validateScope(input.userId, input.institutionId, "student");
    if (!Number.isSafeInteger(Number(input.assessmentId)) || Number(input.assessmentId) <= 0) {
      throw new TypeError("A valid assessment ID is required");
    }
    const answers = input.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      throw new TypeError("Answers must be an object");
    }
    return database.transaction(async (tx) => {
      const assessment = await tx.one(
        "SELECT a.id, a.pass_mark, a.questions_json FROM assessments a JOIN classes c ON c.id = a.class_id JOIN enrollments e ON e.class_id = c.id AND e.student_id = $2 WHERE a.id = $1 AND c.institution_id = $3",
        [Number(input.assessmentId), id, input.institutionId]
      );
      const attempt = assessment && await tx.one(
        "SELECT * FROM attempts WHERE assessment_id = $1 AND student_id = $2",
        [assessment.id, id]
      );
      if (!assessment || !attempt) {
        const error = new Error("Attempt not found");
        error.status = 400;
        throw error;
      }
      if (attempt.submitted_at) {
        return {
          ...attempt,
          timed_out: attempt.submitted_at === attempt.expires_at
        };
      }
      const deadline = Date.parse(attempt.expires_at);
      if (!Number.isFinite(deadline)) {
        const error = new Error("This attempt has no valid deadline. Contact your school administrator.");
        error.status = 400;
        throw error;
      }
      if (Date.now() >= deadline) {
        return finalizeTimedOut(tx, attempt, assessment);
      }
      let questions;
      try { questions = JSON.parse(assessment.questions_json); }
      catch { throw new Error("Assessment questions are unavailable"); }
      const safeAnswers = sanitizeAnswers(questions, answers);
      const result = calculateResult(questions, safeAnswers, assessment.pass_mark);
      await tx.execute(
        "UPDATE attempts SET submitted_at = CURRENT_TIMESTAMP, score = $1, percentage = $2, status = $3, answers_json = $4 WHERE id = $5 AND student_id = $6",
        [result.score, result.percentage, result.status, JSON.stringify(safeAnswers), attempt.id, id]
      );
      return tx.one("SELECT * FROM attempts WHERE id = $1 AND student_id = $2", [attempt.id, id]);
    });
  }

  async function saveAttemptAnswers(input) {
    const id = validateScope(input.userId, input.institutionId, "student");
    if (!Number.isSafeInteger(Number(input.assessmentId)) || Number(input.assessmentId) <= 0) {
      throw new TypeError("A valid assessment ID is required");
    }
    const answers = input.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      throw new TypeError("Answers must be an object");
    }
    return database.transaction(async (tx) => {
      const assessment = await tx.one(
        "SELECT a.id, a.pass_mark, a.questions_json FROM assessments a JOIN classes c ON c.id = a.class_id JOIN enrollments e ON e.class_id = c.id AND e.student_id = $2 WHERE a.id = $1 AND c.institution_id = $3",
        [Number(input.assessmentId), id, input.institutionId]
      );
      const attempt = assessment && await tx.one(
        "SELECT * FROM attempts WHERE assessment_id = $1 AND student_id = $2",
        [assessment.id, id]
      );
      if (!assessment || !attempt) {
        const error = new Error("Attempt not found");
        error.status = 400;
        throw error;
      }
      if (attempt.submitted_at) {
        return { ok: true, timed_out: attempt.submitted_at === attempt.expires_at };
      }
      const deadline = Date.parse(attempt.expires_at);
      if (!Number.isFinite(deadline)) {
        const error = new Error("This attempt has no valid deadline. Contact your school administrator.");
        error.status = 400;
        throw error;
      }
      let questions;
      try { questions = JSON.parse(assessment.questions_json); }
      catch { throw new Error("Assessment questions are unavailable"); }
      if (Date.now() >= deadline) {
        const expired = await finalizeTimedOut(tx, attempt, assessment);
        return { ok: true, timed_out: true, attempt: expired };
      }
      const safeAnswers = sanitizeAnswers(questions, answers);
      await tx.execute(
        "UPDATE attempts SET answers_json = $1 WHERE id = $2 AND student_id = $3 AND submitted_at IS NULL",
        [JSON.stringify(safeAnswers), attempt.id, id]
      );
      return { ok: true, timed_out: false };
    });
  }

  async function expireOverdueAttempts() {
    const now = new Date().toISOString();
    return database.transaction(async (tx) => {
      const overdue = await tx.many(
        "SELECT at.*, a.pass_mark, a.questions_json FROM attempts at JOIN assessments a ON a.id = at.assessment_id WHERE at.submitted_at IS NULL AND at.expires_at IS NOT NULL AND at.expires_at <= $1 ORDER BY at.id",
        [now]
      );
      for (const attempt of overdue) {
        await finalizeTimedOut(tx, attempt, {
          pass_mark: attempt.pass_mark,
          questions_json: attempt.questions_json
        });
      }
      return overdue.length;
    });
  }

  return Object.freeze({
    async startAttempt(input) { return startAttempt(input); },
    async submitAttempt(input) { return submitAttempt(input); },
    async saveAttemptAnswers(input) { return saveAttemptAnswers(input); },
    async expireOverdueAttempts() { return expireOverdueAttempts(); },
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
      return rows.map(row => {
        const result = {
          ...row,
          question_count: JSON.parse(row.questions_json).length
        };
        if (role === "student") delete result.questions_json;
        return result;
      });
    }
  });
}

module.exports = { createAssessmentsRepository };
