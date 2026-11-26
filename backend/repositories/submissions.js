/**
 * Institution-scoped assignment grading operations.
 * Authorization is checked against both the assignment owner and class teacher.
 */
function createSubmissionRepository(database) {
  if (!database || typeof database.transaction !== "function") {
    throw new TypeError("Submission repository requires an async database");
  }

  function validateScope(userId, institutionId, role, submissionId) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      throw new TypeError("A valid user ID is required");
    }
    if (typeof institutionId !== "string" || !institutionId.trim()) {
      throw new TypeError("A valid institution ID is required");
    }
    if (!["school_admin", "teacher"].includes(role)) {
      throw new TypeError("Only school admins and teachers can grade submissions");
    }
    if (!Number.isSafeInteger(Number(submissionId)) || Number(submissionId) <= 0) {
      throw new TypeError("A valid submission ID is required");
    }
    return Number(userId);
  }

  return Object.freeze({
    async gradeSubmission({ userId, institutionId, role, submissionId, score, feedback }) {
      const actorId = validateScope(userId, institutionId, role, submissionId);
      const numericScore = Number(score);
      if (!Number.isFinite(numericScore) || numericScore < 0) {
        const error = new TypeError("A valid non-negative score is required");
        error.status = 400;
        throw error;
      }

      return database.transaction(async (tx) => {
        const submission = await tx.one(
          `SELECT s.id, s.student_id, s.assignment_id, a.title, a.max_score,
                  a.teacher_id, c.teacher_id AS class_teacher_id
           FROM submissions s
           JOIN assignments a ON a.id = s.assignment_id
           JOIN classes c ON c.id = a.class_id
           WHERE s.id = $1 AND c.institution_id = $2`,
          [Number(submissionId), institutionId]
        );
        if (!submission) {
          const error = new Error("Submission not found in this school");
          error.status = 404;
          throw error;
        }
        if (role === "teacher" &&
            Number(submission.teacher_id) !== actorId &&
            Number(submission.class_teacher_id) !== actorId) {
          const error = new Error("Not allowed");
          error.status = 403;
          throw error;
        }
        if (submission.max_score != null && numericScore > Number(submission.max_score)) {
          const error = new TypeError("Score cannot exceed the assignment maximum");
          error.status = 400;
          throw error;
        }

        await tx.execute(
          "UPDATE submissions SET score = $1, feedback = $2 WHERE id = $3",
          [numericScore, String(feedback || ""), Number(submissionId)]
        );
        return {
          studentId: Number(submission.student_id),
          assignmentTitle: submission.title
        };
      });
    }
  });
}

module.exports = { createSubmissionRepository };
