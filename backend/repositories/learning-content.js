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

  async function createForClass({ userId, institutionId, role, classId, kind, values }) {
    const id = validateScope(userId, institutionId, role);
    if (!["school_admin", "teacher"].includes(role)) {
      throw new TypeError("Only school admins and teachers can create learning content");
    }
    if (!Number.isSafeInteger(Number(classId)) || Number(classId) <= 0) {
      throw new TypeError("A valid class ID is required");
    }

    return database.transaction(async (tx) => {
      const schoolClass = await tx.one(
        "SELECT id, teacher_id FROM classes WHERE id = $1 AND institution_id = $2",
        [Number(classId), institutionId]
      );
      if (!schoolClass || (role === "teacher" && Number(schoolClass.teacher_id) !== id)) {
        const error = new Error("Not allowed");
        error.status = 403;
        throw error;
      }

      const insert = kind === "material"
        ? await tx.execute(
            "INSERT INTO materials(title, description, url, file_url, class_id, teacher_id) VALUES($1, $2, $3, $4, $5, $6)",
            [values.title, values.description, values.url, values.fileUrl, Number(classId), id]
          )
        : await tx.execute(
            "INSERT INTO assignments(title, description, due_date, class_id, teacher_id, max_score) VALUES($1, $2, $3, $4, $5, $6)",
            [values.title, values.description, values.dueDate, Number(classId), id, values.maxScore]
          );

      const table = kind === "material" ? "materials" : "assignments";
      const record = await tx.one(`SELECT * FROM ${table} WHERE id = $1`, [insert.insertId]);
      const enrolled = await tx.many(
        "SELECT student_id FROM enrollments WHERE class_id = $1",
        [Number(classId)]
      );
      return {
        [kind]: record,
        studentIds: enrolled.map((row) => Number(row.student_id))
      };
    });
  }

  return Object.freeze({
    async createMaterial(input) {
      return createForClass({ ...input, kind: "material", values: {
        title: input.title, description: input.description || "", url: input.url || "", fileUrl: input.fileUrl || ""
      }});
    },

    async createAssignment(input) {
      return createForClass({ ...input, kind: "assignment", values: {
        title: input.title, description: input.description || "", dueDate: input.dueDate || null,
        maxScore: Number(input.maxScore || 100)
      }});
    },

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
    },

    async listSubmissionsForUser(userId, institutionId, role) {
      const id = validateScope(userId, institutionId, role);
      let visibility = "";
      let params = [institutionId, institutionId];
      if (role === "student") {
        visibility = " AND s.student_id = $3";
        params.push(id);
      } else if (role === "teacher") {
        visibility = " AND (a.teacher_id = $3 OR c.teacher_id = $3)";
        params.push(id);
      }

      return database.many(
        `SELECT s.*, a.title, a.max_score, a.class_id, u.name student_name, u.email
         FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
         JOIN classes c ON c.id = a.class_id
         JOIN users u ON u.id = s.student_id
         JOIN institution_memberships m
           ON m.user_id = u.id
          AND m.institution_id = $1
          AND m.status = 'active'
         WHERE c.institution_id = $2${visibility}
         ORDER BY s.id DESC`,
        params
      );
    }
  });
}

module.exports = { createLearningContentRepository };
