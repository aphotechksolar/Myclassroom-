# V12 security baseline and release blockers

This is a source-code review snapshot of the existing V12 implementation. It is not a penetration test and does not prove that every route is vulnerable or safe. Recheck findings against the current branch before changing implementation.

## Confirmed issues in the inspected V12 source

1. **Fallback JWT secret:** the server uses `dev-secret-change-me` when `JWT_SECRET` is absent. Production must fail closed rather than start with a known secret.
2. **Open CORS:** `app.use(cors())` allows arbitrary origins. Configure an explicit allowlist for the deployed frontend origins.
3. **Reset token disclosure:** `POST /api/auth/request-reset` returns `dev_token` in the response. Production must send a single-use token through a verified email channel and return a generic response.
4. **Demo account seeding:** the database seeds predictable admin, teacher and student credentials when empty; the login page documents them. Remove this behaviour from production and use a controlled first-admin bootstrap flow.
5. **Password policy gaps:** change/reset password routes do not enforce a minimum password policy; validate length and reasonable limits on registration, login, change and reset.
6. **No visible rate limiting:** authentication and reset endpoints need rate limiting and abuse controls.
7. **Uploads:** uploaded filenames are normalised but content type/extension allowlisting, malware scanning and private access controls are not evident in the inspected upload handler.
8. **No evident security-header middleware:** add a reviewed Helmet configuration and a Content Security Policy compatible with the frontend.
9. **SQLite/local uploads:** local files are unsuitable as the production persistence strategy on ephemeral/serverless hosts without durable volumes and backup operations.
10. **Single-school global queries:** the schema and route queries have no tenant identifier. This is a release blocker for a multi-school service.

## Additional authorisation review required

Audit every route for resource-level access control, not only role checks. Specific areas to review include:

- Admin user management and school-level boundaries.
- Assignment grading and teacher ownership checks.
- Assessment attempt lifecycle, expiry enforcement and answer handling.
- Attendance writes: verify that the supplied student belongs to the selected class.
- Student performance/report-card access for administrators and teachers.
- Announcements with no class ID: ensure distribution is school-scoped.
- Messaging: prevent unrelated users in different schools from messaging or discovering one another unless an explicit policy allows it.
- Timetable subject/class consistency.
- File download access and deletion lifecycle.

## Release policy

Do not onboard real institutions or real learner records until the release blockers are resolved, tenant isolation tests pass, data backups and restoration are verified, and the deployment architecture provides durable database and file storage.


## Browser session handling (implemented)

- Browser access tokens are held in `sessionStorage`, not `localStorage`. They remain available across page reloads in the same tab and are cleared when that tab/window session ends.
- Logout removes only the MyClassroom session keys; it does not clear unrelated data for other applications on the same origin.
- API access JWTs expire after eight hours. Users must sign in again after expiry.
- `sessionStorage` reduces persistence on shared devices but is still accessible to JavaScript running on the page. It is not a substitute for a future HttpOnly-cookie session design and strong XSS prevention.


## Browser session implementation (PR #42)

The browser authentication path now uses server-side sessions rather than browser-readable JWTs:

- The browser receives a host-only, HttpOnly, SameSite=Lax cookie named __Host-mc_session in production (with Secure and Path=/), and mc_session for local HTTP development.
- Session identifiers and separate CSRF secrets are 32-byte random values; only SHA-256 hashes are stored.
- Sessions have an eight-hour absolute expiry. Logout revokes the current session; password changes and password resets revoke all sessions for that account.
- Unsafe authenticated requests require a per-session CSRF token in X-CSRF-Token. The token is refreshed through a same-origin POST bootstrap endpoint.
- Production deployments must set APP_ORIGIN to the canonical HTTPS origin (or include it in CORS_ORIGINS) so unsafe requests can pass exact Origin validation.
- The browser no longer stores or sends an authentication bearer token. Bearer compatibility is restricted to NODE_ENV=test for automated integration fixtures only.

This is still the SQLite session-store implementation. It does not make SQLite or local file storage production-scalable, and it does not replace the planned PostgreSQL/private object-storage migration. Validate HTTPS, cookie behavior, reverse-proxy configuration, backup/restore and session cleanup in the actual hosting environment before onboarding schools.
