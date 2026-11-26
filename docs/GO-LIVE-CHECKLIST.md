# Production go-live checklist

**Status: NOT READY FOR LIVE SCHOOL ONBOARDING**

This checklist is the release gate for MyClassroom. A checked item must have evidence from a test, review, or operational record. Do not treat documentation or a passing syntax check as proof that a control is complete.

## 1. Data and tenancy

- [ ] Implement a production PostgreSQL adapter for the async repository contract.
- [ ] Migrate remaining synchronous route queries behind repositories; audit every query for institution scoping.
- [ ] Create versioned PostgreSQL migrations and test both fresh installs and upgrades from supported SQLite versions.
- [ ] Add database constraints and indexes for tenant keys, memberships, enrolments, guardian links and frequently queried records.
- [ ] Test cross-school access for every API route, including IDs supplied in path, query, body, exports and file downloads.
- [ ] Define retention, deletion, export and data-subject request procedures.
- [ ] Test backup restoration and disaster recovery against a documented recovery-point and recovery-time target.

## 2. Authentication and authorization

- [ ] Replace localStorage bearer tokens with a reviewed secure session approach (HttpOnly, Secure, SameSite cookies or equivalent) and implement CSRF protection where required.
- [ ] Review token/session expiry, revocation, logout, password change and multi-school switching.
- [ ] Add MFA or another stronger control for Platform Owner and school administrators.
- [ ] Review rate limits for login, registration, password reset, guardian redemption and sensitive admin actions.
- [ ] Configure password reset delivery, one-time token expiry, abuse controls and email ownership verification.
- [ ] Verify first-login password change for all administrator-created accounts.
- [ ] Review least privilege, school administrator separation, parent read-only restrictions and staff/student offboarding.
- [ ] Protect Platform Owner access with managed secrets, rotation, audit monitoring and restricted operator access.

## 3. Files and uploads

- [ ] Implement private durable object storage; do not rely on local disk in serverless or multi-instance production.
- [ ] Validate file size, extension, declared MIME type and file signature on the server.
- [ ] Add malware scanning/quarantine and safe content-disposition handling.
- [ ] Ensure download authorization checks institution, class membership and record ownership on every request.
- [ ] Test path traversal, malformed filenames, oversized uploads and cross-tenant download attempts.
- [ ] Define retention and deletion behavior for files associated with removed records.

## 4. Application and infrastructure security

- [ ] Complete an independent security review and threat model.
- [ ] Replace or tightly configure the currently disabled Content Security Policy; remove unsafe inline script patterns where practical.
- [ ] Review CORS, Helmet headers, error handling, dependency vulnerabilities and production logging for sensitive data leakage.
- [ ] Add request validation and safe limits to every write endpoint.
- [ ] Add audit events for sensitive user, role, membership, grading, attendance, guardian and institution operations.
- [ ] Configure HTTPS, secure DNS, secret management, firewall/network restrictions and least-privilege service credentials.
- [ ] Add health/readiness monitoring, structured logs, alerting and an incident response runbook.
- [ ] Pin and routinely update dependencies; automate vulnerability checks.

## 5. Product and school operations

- [ ] Complete school onboarding, school profile, academic year/term, grading, class structure and timezone/currency configuration.
- [ ] Verify all role journeys on desktop and real mobile devices: Platform Owner, school admin, teacher, student and parent.
- [ ] Test accessible keyboard navigation, labels, contrast, screen-reader basics and responsive layouts.
- [ ] Verify timetable, attendance, report cards, CSV exports, assessment timing, grading and notifications with realistic test fixtures.
- [ ] Add operational support contacts, school admin guides, teacher guides and parent/student help.
- [ ] Decide and implement subscription/billing, service terms, privacy notice, data-processing terms and school contracts before commercial onboarding.
- [ ] Configure and test email delivery; document invitation and account recovery support.
- [ ] Obtain legal/privacy review appropriate to the countries and ages of students served.

## 6. Release process

- [ ] CI passes on the exact release commit, including syntax, repository, runtime API, integration and browser end-to-end tests.
- [ ] Staging uses isolated non-production database, storage, credentials and test identities.
- [ ] A pilot school completes acceptance testing with synthetic or approved test data.
- [ ] Backup restore, rollback and incident response drills are completed.
- [ ] Performance/load tests cover expected concurrent classes, assessments and file traffic.
- [ ] All high/critical security findings are resolved or explicitly accepted by the accountable owner.
- [ ] Release owner signs off; only then may real schools and student data be onboarded.

## Current known blockers

- SQLite is the only implemented database driver.
- Local filesystem is the only implemented file-storage provider.
- The frontend currently stores bearer tokens in browser local storage.
- Password recovery email delivery is not configured.
- The current automated test suite is not a full browser/end-to-end or independent security assessment.
- The app's existing API still contains synchronous SQL routes that need a complete tenant-scope review.
- Subscription billing and production school onboarding/support workflows are not complete.

These are product and infrastructure blockers, not merely hosting settings. Do not attempt to bypass them by deploying the current build to a serverless host.
