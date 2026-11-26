# HttpOnly cookie session migration plan

## Scope and decision

This document records the source review for replacing browser-readable bearer JWTs with revocable, server-managed browser sessions. It is a design and implementation plan, not an assertion that cookie sessions are already enabled.

**Recommended target:** opaque, cryptographically random session identifiers in HttpOnly cookies, backed by a server-side session table. Do not simply move the existing JWT into an HttpOnly cookie: a stateless JWT cannot be reliably revoked on logout, password change, or a suspected compromise without adding a revocation mechanism.

The existing eight-hour JWT lifetime and sessionStorage change remain in place until the cookie migration is implemented and verified.

## Findings from the current source

- Express serves the static frontend and /api from the same server process. The primary browser deployment is therefore same-origin; cookie authentication does not require cross-origin credentialed CORS for that deployment.
- CORS currently uses the explicit CORS_ORIGINS allowlist, with localhost allowances outside production. It does not enable credentials. Do not change this to wildcard-plus-credentials.
- The frontend API helper attaches Authorization: Bearer from sessionStorage. The learning-material download helper has one separate direct fetch that also attaches the bearer token.
- The backend auth middleware currently accepts only bearer JWTs. JWTs expire after eight hours.
- Login, self-registration, guardian-invitation redemption, institution switching, and password change issue tokens in JSON responses. Each flow must be migrated together; changing only login would break other account journeys.
- School-created accounts are locked to the password-change endpoint until their temporary password is replaced. This restriction must remain enforced when the identity is read from a cookie-backed session.
- Parent accounts are restricted to guardian endpoints after membership resolution. This must remain unchanged.
- Existing authentication rate limiting is mounted on /api/auth; preserve and test it.
- Runtime integration tests currently read JWTs from response JSON and send bearer headers. They need a cookie jar and CSRF support before browser authentication can be switched.

## Target session model

Use a server-side session record with at least:

- A SHA-256 hash of a high-entropy random session identifier (never store the raw identifier).
- User ID and selected institution ID.
- A SHA-256 hash of a separate random CSRF token.
- Created, expiry, last-activity and revoked timestamps.
- Optional metadata needed for security investigation, with a deliberate retention policy.

The browser receives the raw session identifier only in a cookie:

- Name: a host-only cookie such as __Host-mc_session in HTTPS production.
- HttpOnly, Secure in production, Path=/, no Domain, SameSite=Lax.
- Eight-hour absolute expiry initially, aligned with the existing session window. Do not silently introduce an unlimited sliding session.
- Clear the cookie with matching path/security attributes on logout.

The CSRF token is not an authentication credential. Provide it through a same-origin authenticated bootstrap endpoint and keep it in page memory; require it in a custom header for every state-changing request authenticated by a cookie. Store only its hash in the session record. Also validate the request Origin against the configured application origin for unsafe cookie-authenticated requests. Reject a missing or mismatched CSRF token. Do not rely on SameSite alone.

## Flow-by-flow migration requirements

1. **Login:** verify credentials and selected active membership as today; create a fresh session and set the cookie. Do not return a bearer token in JSON. Clear/replace any pre-existing session cookie to prevent session fixation.
2. **Multi-school selection:** preserve the current 409 response when a password-verified account has multiple active memberships. After the user selects a school, create a session scoped to that membership.
3. **Self-registration:** create the account/membership as today, then establish a cookie session. Do not return a bearer token.
4. **Guardian invitation redemption:** preserve one-time token, invited-email and existing-account password checks. Establish a parent session only after the invitation transaction succeeds.
5. **Institution switch:** verify the requested active membership, revoke the current session, and issue a new session scoped to the selected institution. Never accept an arbitrary institution ID.
6. **Temporary password change:** permit the restricted password-change request using the current session; after success, revoke existing sessions for the user and issue a fresh session. Preserve the mandatory first-login lockout.
7. **Normal password change and future password reset:** revoke all sessions for the user after a successful password change/reset. Password recovery remains disabled until verified email delivery is configured.
8. **Logout:** revoke the current server-side session and clear the cookie. The response should be safe to repeat.
9. **Protected APIs and downloads:** authenticate using the session cookie, then continue resolving active institution membership and enforcing the existing role, parent and resource checks. Update the separate material-download fetch.
10. **Expired, revoked or suspended access:** reject the session. Continue checking institution status/membership on each request so suspension and membership removal take effect immediately.

## CSRF, CORS and origin rules

- Keep the production browser app and API same-origin where possible.
- Configure one explicit canonical application origin for production and validate unsafe cookie-authenticated requests against it. Behind a reverse proxy, use a trusted deployment configuration; do not construct the trusted origin from an untrusted Host or forwarded header.
- Require a per-session synchronizer token in a custom request header on POST, PUT, PATCH and DELETE requests authenticated by cookies.
- Ensure the CSRF bootstrap response is not cacheable.
- Reject cross-origin credentialed requests by default. If a separate frontend origin is introduced later, document and configure exact origins, credentialed CORS, cookie SameSite/Secure behavior and preflight handling as a separate reviewed change.
- Keep platform-owner secret authentication separate; do not convert it into a school-user session.

## Implementation sequence

1. Add a session repository and SQLite-backed implementation behind a small interface. Add schema migration, expiry/revocation cleanup and repository tests.
2. Add cookie issuance, clearing, session authentication, CSRF bootstrap and Origin validation. Keep bearer authentication temporarily for automated tests or explicitly approved non-browser integrations, but do not let the browser continue receiving or storing bearer tokens once cookie mode is enabled.
3. Migrate every authentication-issuing route listed above and add tests for cookie flags, token non-disclosure, rotation, logout revocation, password-change revocation, school switching, temporary-password lockout, parent restrictions, CSRF failures, Origin failures and suspended memberships.
4. Migrate the frontend API helper and direct file download to same-origin cookies and CSRF headers. Remove browser token storage and bearer headers only after all flows pass.
5. Run the full runtime API suite and browser end-to-end tests in a real HTTPS staging environment, including login, reload, multi-school selection, guardian redemption, password change, logout and file download.
6. Only after a reviewed compatibility window, decide whether legacy bearer authentication can be removed. Do not leave a permanent unmonitored fallback.

## Rollback and release gates

- The first implementation should be feature-gated so a failed staging rollout can return to the existing eight-hour bearer flow without changing production data.
- Do not enable cookie mode on a production host until HTTPS, canonical origin configuration, proxy behavior, cookie attributes and CSRF checks have been verified.
- Do not deploy or onboard real schools as part of this code change.
- No Supabase project, PostgreSQL database, storage provider, production secret or hosting configuration is required for this session work.
- Required acceptance: no authentication token in browser-readable storage or JSON responses; logout and password change revoke server-side sessions; cross-school and parent authorization tests still pass; cross-site state-changing requests fail; legitimate same-origin browser workflows pass.


## Implementation status — PR #42

The first browser-session integration is implemented on the PR branch:

- Login, self-registration, guardian invitation redemption, school switching and password changes issue server-side sessions.
- Production browser authentication uses the host-only __Host-mc_session HttpOnly/Secure cookie; local HTTP development uses mc_session.
- CSRF protection is applied to unsafe authenticated requests. A same-origin POST refreshes the synchronizer token after page reload.
- Logout revokes the current session. Password change and password reset revoke all active sessions for the user.
- Active school membership, school suspension, first-login password-change restrictions and parent route restrictions are rechecked by the session authentication middleware.
- The frontend no longer stores the authentication secret in sessionStorage and no longer attaches bearer tokens to API requests.
- Automated integration fixtures retain a test-only bearer compatibility path; it is disabled outside NODE_ENV=test.

Production configuration: set APP_ORIGIN to the exact public HTTPS origin (for example, https://school.example) or include that exact origin in CORS_ORIGINS. Do not use wildcard origins. Verify HTTPS termination and secure cookie forwarding before launch.

This does not yet move sessions to PostgreSQL. The current session store uses the same SQLite database as the existing application and inherits its deployment limitations. The PR is not a production launch approval.
