/**
 * Institution- and user-scoped notification operations.
 *
 * Both identifiers must come from the authenticated membership context.
 */
function createNotificationsRepository(database) {
  if (!database || typeof database.many !== "function" || typeof database.execute !== "function") {
    throw new TypeError("Notifications repository requires an async database");
  }

  function validateScope(userId, institutionId) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      throw new TypeError("A valid user ID is required");
    }
    if (typeof institutionId !== "string" || !institutionId.trim()) {
      throw new TypeError("A valid institution ID is required");
    }
    return Number(userId);
  }

  return Object.freeze({
    async listForUser(userId, institutionId) {
      const id = validateScope(userId, institutionId);
      return database.many(
        "SELECT * FROM notifications WHERE user_id = $1 AND institution_id = $2 ORDER BY id DESC LIMIT 100",
        [id, institutionId]
      );
    },

    async markRead(notificationId, userId, institutionId) {
      const id = validateScope(userId, institutionId);
      if (!Number.isSafeInteger(Number(notificationId)) || Number(notificationId) <= 0) {
        throw new TypeError("A valid notification ID is required");
      }
      return database.execute(
        "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND institution_id = $3",
        [Number(notificationId), id, institutionId]
      );
    }
  });
}

module.exports = { createNotificationsRepository };
