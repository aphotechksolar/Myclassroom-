/**
 * Institution-scoped read access for school settings.
 *
 * The institution ID is always supplied by the authenticated membership
 * context; callers must not accept it from request query/body parameters.
 */
function createSettingsRepository(database) {
  if (!database || typeof database.many !== "function" || typeof database.transaction !== "function") {
    throw new TypeError("Settings repository requires an async database");
  }

  return Object.freeze({
    async listForInstitution(institutionId) {
      if (typeof institutionId !== "string" || !institutionId.trim()) {
        throw new TypeError("A valid institution ID is required");
      }
      return database.many(
        "SELECT key, value FROM institution_settings WHERE institution_id = $1 ORDER BY key",
        [institutionId]
      );
    },

    async updateForInstitution(institutionId, values) {
      if (typeof institutionId !== "string" || !institutionId.trim()) {
        throw new TypeError("A valid institution ID is required");
      }
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new TypeError("Settings must be supplied as an object");
      }
      const entries = Object.entries(values);
      return database.transaction(async (tx) => {
        for (const [key, value] of entries) {
          await tx.execute(
            `INSERT INTO institution_settings(institution_id,key,value,updated_at)
             VALUES($1,$2,$3,CURRENT_TIMESTAMP)
             ON CONFLICT(institution_id,key) DO UPDATE
             SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`,
            [institutionId, key, String(value)]
          );
        }
        return { updated: entries.length };
      });
    }
  });
}

module.exports = { createSettingsRepository };
