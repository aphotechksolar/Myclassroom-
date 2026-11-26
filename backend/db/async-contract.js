/**
 * Minimal asynchronous repository contract used by new code while the legacy
 * API continues to use better-sqlite3 directly.
 *
 * Methods:
 * - many(sql, params): Promise<row[]>
 * - one(sql, params): Promise<row | undefined>
 * - execute(sql, params): Promise<{ rowCount, insertId }>
 * - transaction(async tx => ...): Promise<value>
 * - close(): Promise<void>
 *
 * SQL in this contract uses PostgreSQL-style numbered placeholders ($1, $2).
 * Drivers are responsible for adapting their own parameter syntax.
 */
function assertExecutor(executor) {
  for (const method of ["many", "one", "execute"]) {
    if (typeof executor[method] !== "function") {
      throw new TypeError(`Database executor must implement ${method}()`);
    }
  }
}

function createAsyncDatabase({ executor, transaction, close }) {
  assertExecutor(executor);
  if (typeof transaction !== "function") throw new TypeError("Database must implement transaction()");
  if (typeof close !== "function") throw new TypeError("Database must implement close()");

  return Object.freeze({
    many: (sql, params = []) => executor.many(sql, params),
    one: (sql, params = []) => executor.one(sql, params),
    execute: (sql, params = []) => executor.execute(sql, params),
    transaction: (work) => {
      if (typeof work !== "function") throw new TypeError("transaction() requires an async callback");
      return transaction(work);
    },
    close: () => close()
  });
}

module.exports = { createAsyncDatabase };
