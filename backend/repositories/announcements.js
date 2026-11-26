/**
 * Institution-scoped announcement reads.
 *
 * Student visibility is restricted to school-wide announcements and
 * announcements for classes in which the authenticated student is enrolled.
 */
function createAnnouncementsRepository(database) {
  if (!database || typeof database.many !== "function") {
    throw new TypeError("Announcements repository requires an async database");
  }

  return Object.freeze({
    async listForUser(userId, institutionId, isStudent) {
      if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
        throw new TypeError("A valid user ID is required");
      }
      if (typeof institutionId !== "string" || !institutionId.trim()) {
        throw new TypeError("A valid institution ID is required");
      }
      if (typeof isStudent !== "boolean") {
        throw new TypeError("A valid user role is required");
      }

      if (isStudent) {
        return database.many(
          `SELECT a.*, c.name class_name, u.name author_name
           FROM announcements a
           LEFT JOIN classes c ON c.id = a.class_id
           LEFT JOIN users u ON u.id = a.author_id
           LEFT JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = $2
           WHERE a.institution_id = $1
             AND (a.class_id IS NULL OR e.student_id = $2)
           ORDER BY a.id DESC`,
          [institutionId, Number(userId)]
        );
      }

      return database.many(
        `SELECT a.*, c.name class_name, u.name author_name
         FROM announcements a
         LEFT JOIN classes c ON c.id = a.class_id
         LEFT JOIN users u ON u.id = a.author_id
         WHERE a.institution_id = $1
         ORDER BY a.id DESC`,
        [institutionId]
      );
    }
  });
}

module.exports = { createAnnouncementsRepository };
