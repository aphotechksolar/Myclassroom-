const { openSqliteDatabase } = require("./sqlite");
const { openAsyncSqliteDatabase } = require("./sqlite-async");

/**
 * Central database entry point. SQLite remains the only supported runtime
 * driver in this phase; PostgreSQL must not be selected until its adapter,
 * migrations, and contract tests are implemented.
 */
function createDatabase(filename, driver = process.env.DATABASE_DRIVER || "sqlite") {
  if (driver === "sqlite") return openSqliteDatabase(filename);
  throw new Error(`Unsupported DATABASE_DRIVER "${driver}". Only "sqlite" is available in this release.`);
}

/**
 * Opens the opt-in asynchronous repository interface over SQLite.
 * The existing synchronous application entry point is intentionally unchanged.
 */
function createAsyncSqliteDatabase(filename) {
  return openAsyncSqliteDatabase(openSqliteDatabase(filename));
}

module.exports = { createDatabase, createAsyncSqliteDatabase };
