const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

/**
 * Opens the existing SQLite database behind a small driver boundary.
 * The returned handle intentionally preserves the current better-sqlite3 API
 * while the application is migrated incrementally.
 */
function openSqliteDatabase(filename) {
  // Keep SQLite's special in-memory filename intact. Resolving it as a path
  // creates a shared on-disk file named ":memory:" and leaks state between tests.
  const resolved = filename === ":memory:" ? filename : path.resolve(filename);
  if (resolved !== ":memory:") {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  return db;
}

module.exports = { openSqliteDatabase };
