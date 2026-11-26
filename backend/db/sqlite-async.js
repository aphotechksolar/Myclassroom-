const { createAsyncDatabase } = require("./async-contract");

/**
 * Adapts the existing synchronous SQLite connection to the async repository
 * contract. All operations are serialized on the single SQLite connection.
 * Transaction callbacks receive a scoped executor and must use that executor
 * for every statement inside the transaction.
 */
function openAsyncSqliteDatabase(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.exec !== "function") {
    throw new TypeError("openAsyncSqliteDatabase requires a better-sqlite3 connection");
  }

  let queue = Promise.resolve();
  let closed = false;

  function schedule(work) {
    const result = queue.then(() => {
      if (closed) throw new Error("Database connection is closed");
      return work();
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function bindSql(sql, params) {
    if (typeof sql !== "string" || !Array.isArray(params)) {
      throw new TypeError("SQL must be a string and params must be an array");
    }
    const ordered = [];
    const converted = sql.replace(/\$(\d+)/g, (_match, position) => {
      const index = Number(position) - 1;
      if (index < 0 || index >= params.length) {
        throw new RangeError(`Missing SQL parameter $${position}`);
      }
      ordered.push(params[index]);
      return "?";
    });
    return { sql: converted, params: ordered };
  }

  function createExecutor() {
    return {
      async many(sql, params = []) {
        const bound = bindSql(sql, params);
        return db.prepare(bound.sql).all(...bound.params);
      },
      async one(sql, params = []) {
        const bound = bindSql(sql, params);
        return db.prepare(bound.sql).get(...bound.params);
      },
      async execute(sql, params = []) {
        const bound = bindSql(sql, params);
        const result = db.prepare(bound.sql).run(...bound.params);
        return {
          rowCount: result.changes,
          insertId: result.lastInsertRowid === undefined ? null : Number(result.lastInsertRowid)
        };
      }
    };
  }

  const executor = createExecutor();

  return createAsyncDatabase({
    executor: {
      many: (sql, params) => schedule(() => executor.many(sql, params)),
      one: (sql, params) => schedule(() => executor.one(sql, params)),
      execute: (sql, params) => schedule(() => executor.execute(sql, params))
    },
    transaction: (work) => schedule(async () => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(createExecutor());
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
        throw error;
      }
    }),
    close: () => schedule(() => {
      db.close();
      closed = true;
    })
  });
}

module.exports = { openAsyncSqliteDatabase };
