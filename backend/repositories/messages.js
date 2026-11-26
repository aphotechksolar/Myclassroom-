/**
 * Institution-scoped messaging inbox reads.
 *
 * A user can see only messages where they are a sender or receiver, and
 * both participants must still have active membership in the same school.
 */
function createMessagesRepository(database) {
  if (!database || typeof database.many !== "function") {
    throw new TypeError("Messages repository requires an async database");
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
        `SELECT m.*, s.name sender_name, r.name receiver_name
         FROM messages m
         JOIN users s ON s.id = m.sender_id
         JOIN users r ON r.id = m.receiver_id
         JOIN institution_memberships sm
           ON sm.user_id = m.sender_id
          AND sm.institution_id = $1
          AND sm.status = 'active'
         JOIN institution_memberships rm
           ON rm.user_id = m.receiver_id
          AND rm.institution_id = $1
          AND rm.status = 'active'
         WHERE m.institution_id = $1
           AND (m.sender_id = $2 OR m.receiver_id = $2)
         ORDER BY m.id DESC`,
        [institutionId, Number(userId)]
      );
    }
  });
}

module.exports = { createMessagesRepository };
