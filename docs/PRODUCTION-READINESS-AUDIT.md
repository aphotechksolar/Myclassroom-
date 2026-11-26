# MyClassroom V12 Production-Readiness Audit

Audit date: 2026-11-26

## Scope

Read-only review of the current `main` branch after the multi-tenant foundation, platform-owner onboarding, and runtime tenant-isolation test changes. No live database, deployment, or storage service was modified.

## Findings

### 1. Database portability — high priority

The API creates a `better-sqlite3` database directly in `backend/server.js` and uses synchronous SQLite APIs throughout route handlers. Startup schema creation and tenant-column upgrades use SQLite DDL and `PRAGMA table_info`. The three migration scripts also instantiate SQLite directly.

A PostgreSQL migration therefore requires a database adapter and SQL conversion, not just a new environment variable. SQLite-specific patterns observed include `INSERT OR IGNORE`, `lastInsertRowid`, `changes`, `PRAGMA`, `AUTOINCREMENT`, and synchronous transaction callbacks.

### 2. Uploaded files — high priority

Multer writes learning materials to a local `backend/uploads` directory. The API has an authenticated download route and checks class access before sending the file, but the file is not durable across ephemeral deployments or multiple application instances.

The upload currently enforces a 10 MB size limit but does not demonstrate a complete MIME allowlist or file-signature validation. The stored file path is derived from a sanitized version of the original filename plus a timestamp. Move to random object keys and a private bucket, with explicit institution/class metadata and authorization.

### 3. Authentication and tenant authorization — continue hardening

The API retains its own JWT and membership model. The runtime integration test verifies two-school isolation for class listing/dashboard access and verifies that suspending a school blocks its existing session. This is valuable coverage but does not prove every endpoint and file workflow is isolated.

Expand tests to cover student, teacher, school-admin, and platform-owner permissions across assessments, submissions, results, attendance, messages, notifications, report cards, settings, and files.

### 4. Password recovery and onboarding

Password recovery currently stores a hashed reset token but deliberately does not deliver it by email. The endpoint correctly avoids returning the token to the caller. Do not enable customer-facing reset until a verified email delivery provider and token lifecycle controls are implemented.

School administrator creation accepts an initial password, but a forced first-login password change is not yet evident. Add this before real school onboarding.

### 5. Hosting and secrets

Production startup rejects a missing or short JWT secret. Platform-owner routes require a high-entropy server-side key. Keep both only in encrypted deployment environment variables. The current local-disk and SQLite assumptions must be removed from production deployment before horizontal scaling or serverless hosting.

### 6. Supabase platform considerations

The connected account currently contains an existing project named `aphotechksolar's Project` in `eu-west-3`. Its purpose is not established by this repository audit, so it must not be repurposed for MyClassroom without confirmation. Use a dedicated project after reviewing the organization, region, plan, and quoted cost.

Supabase's current connection guidance distinguishes direct PostgreSQL connections, session pooling for persistent IPv4-only backends, and transaction pooling for serverless/temporary clients. The eventual connection mode must match the actual hosting runtime. Transaction pooling does not support prepared statements.

New Supabase tables are no longer automatically exposed through the Data API by default as of the current platform rollout. MyClassroom's first migration should use the backend's private PostgreSQL connection and should not require exposing tables to the browser Data API.

## Recommended next engineering steps

1. Introduce a database adapter and contract tests while retaining SQLite as the default.
2. Inventory and convert SQLite-specific SQL in small, testable groups.
3. Add PostgreSQL schema migrations and run the existing API suite against PostgreSQL.
4. Introduce a storage adapter with local and private-object-storage implementations.
5. Add first-login password change, upload validation, and broader tenant/file authorization tests.
6. Rehearse data and file migration in a separate project before considering a production cutover.

## Release gate

This audit is not a production approval. No live data has been migrated, no Supabase project has been created or modified, and no production credentials have been requested or stored.
