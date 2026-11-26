/**
 * Institution-scoped messaging operations.
 *
 * Inbox reads require the user and both participants to have active
 * membership in the same school. Read receipts can only be set by receiver.
 */
function createMessagesRepository(database) {
  if (!database || typeof database.many !== "function" || typeof database.execute !== "function") {
    throw new TypeError("Messages repository requires an async database");
  }

  function assertUserId(userId) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      throw new TypeError("A valid user ID is required");
    }
    return Number(userId);
  }

  function assertInstitutionId(institutionId) {
    if (typeof institutionId !== "string" || !institutionId.trim()) {
      throw new TypeError("A valid institution ID is required");
    }
    return institutionId;
  }

  return Object.freeze({
    async listForUser(userId, institutionId) {
      const id = assertUserId(userId);
      const institution = assertInstitutionId(institutionId);
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
        [institution, id]
      );
    },

    async markRead(messageId, receiverId, institutionId) {
      const id = assertUserId(messageId);
      const receiver = assertUserId(receiverId);
      const institution = assertInstitutionId(institutionId);
      return database.execute(
        "UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND receiver_id = $2 AND institution_id = $3",
        [id, receiver, institution]
      );
    }
  });
}

module.exports = { createMessagesRepository };
