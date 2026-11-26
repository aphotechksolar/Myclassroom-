/**
 * Institution-scoped read access for school settings.
 *
 * The institution ID is always supplied by the authenticated membership
 * context; callers must not accept it from request query/body parameters.
 */
function createSettingsRepository(database) {
  if (!database || typeof database.many !== "function") {
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
    }
  });
}

module.exports = { createSettingsRepository };
