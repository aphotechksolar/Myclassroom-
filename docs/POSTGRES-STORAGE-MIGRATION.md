# PostgreSQL and Object Storage Migration Plan

## Decision

Use Supabase-managed PostgreSQL for the production relational database and a private Supabase Storage bucket for learning materials. Keep the existing Express API and its application-level JWT/membership authorization during the first migration. Do not move student-facing authentication to Supabase Auth as part of this database migration.

This is a staged migration, not a cutover. SQLite remains the local-development and rollback baseline until the PostgreSQL implementation passes parity and integration tests.

## Current application baseline

- Node.js / Express API in `backend/server.js`.
- `better-sqlite3` is instantiated directly in the server and used throughout route handlers.
- The schema is created and extended at application startup with SQLite DDL and PRAGMA calls.
- Migration scripts open `backend/data/myclassroom.db` directly.
- Learning materials are written to local disk by Multer and recorded in `materials.file_url`.
- Auth uses application-issued JWTs and bcrypt password hashes. School membership and role are resolved by the API on authenticated requests.
- Runtime tenant-isolation tests use temporary SQLite and upload directories.

## Why a staged migration is required

The current server has direct SQLite calls throughout the API. SQLite-specific behavior includes:
- `better-sqlite3` synchronous `prepare().get/all/run` and `transaction()` APIs.
- `INTEGER PRIMARY KEY AUTOINCREMENT`, `INSERT OR IGNORE`, `lastInsertRowid`, and `changes`.
- `PRAGMA` schema introspection and foreign-key configuration.
- SQLite boolean expressions, date/time defaults, and `ON CONFLICT` behavior.

A connection-string replacement is not sufficient. A production migration must preserve response shapes, transaction boundaries, generated IDs, uniqueness behavior, timestamps, and all existing V12 workflows.

## Target architecture

1. Express remains the only application API boundary in the first release.
2. PostgreSQL is accessed from the backend using a server-side PostgreSQL driver and a private connection string.
3. The database layer is isolated behind a small repository/query adapter so routes do not depend on SQLite-specific APIs.
4. Use Supabase's direct PostgreSQL connection for persistent non-serverless hosts, or the Supavisor session pooler for IPv4-only persistent hosts. If deployed in serverless functions, use the Supavisor transaction pooler and ensure the driver does not rely on named prepared statements.
5. Do not expose database credentials, Supabase secret/service-role keys, or privileged storage credentials to browser code.
6. Keep the existing application JWT and institution-membership checks during the first migration. Supabase Auth adoption, if desired later, is a separate design decision.
7. Keep Supabase Storage private. Store opaque object keys and metadata in PostgreSQL; never store public bucket URLs for student work or learning materials.
8. Store objects under institution-scoped keys, for example `<institution_id>/materials/<random-object-id>`. The Express API must authorize membership and class access before returning a short-lived signed download URL or streaming an object.
9. Treat the database as the source of truth for object ownership. Add cleanup/reconciliation for failed uploads and deleted records.

## Required PostgreSQL work

- Create a versioned PostgreSQL schema migration set for every existing V12 table and index.
- Preserve institution and membership foreign keys, uniqueness rules, and cascade behavior.
- Add explicit tenant ownership to any tenant-owned records whose isolation currently depends only on a join through classes.
- Replace SQLite-specific SQL and APIs with parameterized PostgreSQL queries.
- Use explicit transactions for multi-step operations (institution onboarding, registration, assessment submission, grading, and other write workflows).
- Use safe identity generation and return generated IDs with `RETURNING`.
- Standardize timestamps as `timestamptz` and define UTC storage semantics.
- Add database constraints and indexes for tenant IDs and common access paths.
- Keep platform-owner operations separate from school-level permissions.

## Required file-storage work

- Create a private bucket for school learning materials.
- Validate upload size, extension, MIME type, and file signature where practical; do not trust the client-supplied MIME type.
- Generate opaque object names; do not use user-supplied filenames as storage paths.
- Record institution ID, class ID, uploader ID, object key, MIME type, size, and timestamps in a metadata table.
- Authorize upload and download against the active school membership and class permissions.
- Use short-lived signed URLs or authenticated API streaming; do not make the bucket public.
- Define deletion behavior and a reconciliation job for orphaned objects.
- Keep a local-disk adapter for local development and automated tests.

## Migration sequence

### Phase 0 — completed audit / planning
- Inventory SQLite-specific SQL, schema creation, migrations, and local file usage.
- Document the target design and compatibility requirements.
- Do not connect to or modify a live database.

### Phase 1 — portable data layer
- Introduce an explicit database interface and isolate current SQLite implementation behind it.
- Add contract tests for reads, writes, transactions, IDs, and error handling.
- Convert route handlers incrementally without changing API behavior.
- Keep the existing runtime tenant-isolation suite green.

### Phase 2 — PostgreSQL implementation
- Add a PostgreSQL schema and adapter.
- Run the same database contract and API integration tests against SQLite and PostgreSQL.
- Add cross-school tests for all major resource families and roles.
- Do not cut over production traffic yet.

### Phase 3 — private object storage
- Add storage interface with local-disk and Supabase Storage implementations.
- Test tenant authorization, signed URL expiry, invalid files, large files, and orphan cleanup.
- Preserve access to existing local files during migration.

### Phase 4 — data migration rehearsal
- Take a consistent SQLite backup.
- Export and transform data with explicit type/ID mapping.
- Import into an isolated PostgreSQL project.
- Compare table counts, foreign-key integrity, school ownership, and representative records.
- Copy existing files and verify object checksums and metadata.
- Run the full V12 workflow and tenant-isolation tests against the rehearsal environment.

### Phase 5 — controlled cutover
- Require a fresh backup and documented rollback procedure.
- Put the app into maintenance/read-only mode during final sync.
- Verify counts, authentication, school boundaries, materials, exams, attendance, results, reports, and admin operations.
- Switch production configuration only after explicit approval.
- Keep the old SQLite backup and file archive untouched until the agreed retention period ends.

## Rollback

Before cutover, rollback means keeping SQLite and local uploads active. After cutover, do not attempt an automatic reverse sync. Restore service to the last consistent SQLite backup only if all writes since cutover can be safely reconciled or the owner accepts the recovery point. Document the exact recovery point and data-loss window before cutover.

## Acceptance criteria

- Existing V12 features behave the same through the Express API.
- No school can read, modify, download, or infer another school's records or files.
- Parent accounts remain blocked until parent-child authorization is implemented.
- All database contract tests pass against both adapters.
- All runtime tenant-isolation tests pass against PostgreSQL.
- Upload validation, private access, and cross-tenant file denial tests pass.
- Migration rehearsal has no unexplained row-count, relationship, or file-checksum mismatches.
- No secrets are committed to Git or exposed in frontend assets.
- Production cutover is separately approved by the owner.

## Operational prerequisites

A dedicated MyClassroom Supabase project should be used. Do not reuse an existing project merely because it is available in the connected account; confirm its purpose and data ownership first. Project creation can incur charges and requires an explicit cost review. Store connection strings and secret keys only in the deployment platform's encrypted environment variables.

Do not onboard real schools or import real student records until the security review, integration tests, backup/restore rehearsal, and production configuration checks are complete.
