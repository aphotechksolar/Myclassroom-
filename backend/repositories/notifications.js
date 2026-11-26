/**
 * Institution- and user-scoped notification reads.
 *
 * Both identifiers must come from the authenticated membership context.
 */
function createNotificationsRepository(database) {
  if (!database || typeof database.many !== "function") {
    throw new TypeError("Notifications repository requires an async database");
  }

  return Object.freeze({
    async listForUser(userId, institutionId) {
      if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
        throw new TypeError("A valid user ID is required");
      }
      if (typeof institutionId !== "string" || !institutionId.trim()) {
        throw new TypeError("A valid institution ID is required");
      }
      return database.many(
        "SELECT * FROM notifications WHERE user_id = $1 AND institution_id = $2 ORDER BY id DESC LIMIT 100",
        [Number(userId), institutionId]
      );
    }
  });
}

module.exports = { createNotificationsRepository };
