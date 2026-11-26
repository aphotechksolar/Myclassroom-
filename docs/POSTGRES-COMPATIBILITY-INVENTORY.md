# PostgreSQL Compatibility Inventory

## Purpose

This document records the current database coupling in MyClassroom V12 before any PostgreSQL implementation is attempted. It is an engineering inventory, not a migration instruction. SQLite remains the only supported runtime database.

## Snapshot reviewed

Reviewed on 2026-11-26 from the `main` branch after the storage-boundary work.

| Area | Current implementation | Observed usage |
|---|---|---:|
| Main API | `backend/server.js` | 179 `db.prepare()`, 6 `db.exec()`, 1 `db.transaction()` call sites |
| Existing migrations | `backend/migrations/001*`, `002*`, `003*` | SQLite-oriented migration scripts |
| Database boundary | `backend/db/index.js`, `backend/db/sqlite.js` | Explicit driver selection; SQLite only |
| Adapter tests | `backend/test/database-adapter.test.js` | Synchronous prepared statements, result metadata, transactions, rollback, foreign keys |

The counts above are source-level call-site counts, not a count of unique SQL statements. They should be regenerated as the code changes.

## Compatibility findings

### 1. The current API depends on synchronous better-sqlite3 semantics

The application expects calls such as `db.prepare(sql).get(...)`, `.all(...)`, and `.run(...)` to return values immediately. Write paths also read SQLite result metadata such as `lastInsertRowid` and `changes`.

A Node PostgreSQL client such as `pg` is asynchronous. It cannot safely replace this interface by swapping the driver in `createDatabase()`. Doing so would make existing route handlers operate on unresolved promises or incompatible result objects.

**Decision:** do not add a PostgreSQL driver behind the existing synchronous handle. Introduce an asynchronous repository/service contract and migrate route families incrementally.

### 2. SQL dialect and behavior need deliberate translation

The current server schema and queries include SQLite-specific or SQLite-shaped behavior, including:

- `INTEGER PRIMARY KEY AUTOINCREMENT` identity columns.
- Positional `?` parameters (412 question-mark characters occur in the current server source; this is a lexical count, not a parameter count).
- `INSERT OR IGNORE` conflict handling.
- SQLite conflict clauses and SQLite result metadata.
- `CURRENT_TIMESTAMP` defaults and SQLite PRAGMA-based foreign-key setup.
- Multi-statement schema initialization through `db.exec()`.

PostgreSQL equivalents must be designed and tested explicitly. Examples include identity/serial columns, numbered parameters (`$1`, `$2`), `ON CONFLICT ... DO NOTHING`, `RETURNING`, and database-level foreign-key enforcement. These are design directions, not a completed SQL conversion.

### 3. Startup schema and migrations are coupled to SQLite

The main server currently creates much of its schema during startup. The existing migration scripts also use the current SQLite database interface. PostgreSQL needs its own versioned migration path and a clear rule for whether schema changes happen at deploy time or application startup.

**Decision:** keep current SQLite initialization unchanged while a separate, versioned PostgreSQL migration set is developed and tested against disposable databases.

### 4. Transactions need an asynchronous contract

The current adapter test verifies synchronous transaction callbacks and rollback. PostgreSQL transactions require a checked-out client/connection for the full transaction and awaited statements. A future repository contract must make transaction boundaries explicit and ensure all statements in a transaction use the same connection.

### 5. Tenant isolation remains an application-level requirement

The database transition must preserve the existing institution-membership checks and authorization behavior. PostgreSQL row-level security may be evaluated as defence in depth, but it must not replace API authorization or be enabled without tests proving tenant context is set safely for every transaction/connection.

## Recommended implementation sequence

1. **Contract definition:** define a small asynchronous database/repository contract for query, single-row lookup, writes, generated IDs, and transactions. Keep it independent of either SQL dialect.
2. **SQLite implementation:** implement that contract over better-sqlite3, including safe promise-compatible behavior and contract tests. Keep the existing application path working until each route family has moved.
3. **Pilot repository:** move one low-risk, tenant-scoped resource family behind the repository interface. Add tests for success, missing records, authorization, and cross-institution denial.
4. **PostgreSQL implementation:** add a PostgreSQL adapter using a connection pool only after the contract is stable. Use parameterized SQL and explicit transaction-scoped clients.
5. **Parity tests:** run the same repository contract and tenant-isolation scenarios against SQLite and a disposable PostgreSQL test database in CI.
6. **Schema migration:** add PostgreSQL-specific versioned migrations and test clean install, upgrade, rollback strategy, indexes, constraints, and seed/bootstrap flows.
7. **Cutover planning:** only after parity and security gates pass, plan a separate MyClassroom-only hosted database. No live database, production data, or existing Aphotech Solar Supabase project is part of this work.

## Explicit non-goals for this phase

- No `pg` dependency or PostgreSQL runtime selection.
- No edits to the current SQLite schema or production data.
- No Supabase project, database, bucket, or credentials creation/use.
- No production deployment or data cutover.
- No changes to Aphotech Solar or its existing Supabase project.

## Acceptance criteria for the next code phase

- A documented asynchronous contract with typed/defined return semantics.
- SQLite contract tests cover reads, lists, writes, generated IDs, affected-row behavior, transaction commit, and rollback.
- Existing runtime tenant-isolation tests continue to pass unchanged.
- The current default remains SQLite and unsupported drivers fail explicitly.
