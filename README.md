# MyClassroom

MyClassroom is a multi-school learning and school-management platform. It is being developed as a product that can be configured and operated by multiple independent schools, rather than as a single school's website.

## Current capabilities

- Platform Owner console for institution creation, suspension and reactivation.
- Institution-scoped school administrator, teacher, student and verified parent/guardian access.
- Multi-school login selection for accounts with memberships in more than one school.
- School-created accounts with mandatory first-login password change.
- Classes, enrolment, subjects and timetables.
- Learning materials, assignments, submissions and teacher grading.
- Timed quizzes and examinations with server-side deadlines, autosaved answers and automatic marking.
- Attendance, results, gradebook, rankings and report cards.
- School announcements, notifications and institution-scoped messaging.
- Guardian invitations, revocation and read-only access to linked children's school progress.
- Responsive student, parent and school administration experiences.

## Local development

Requirements: Node.js 20 recommended (Node.js 18+ may work) and a working native build toolchain for `better-sqlite3`.

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and set a unique local JWT_SECRET.
npm run check
npm test
npm start
```

Open [http://localhost:3000](http://localhost:3000). The Express server serves the frontend and API from one process. Local SQLite data is stored in `backend/data` and uploaded learning files in `backend/uploads` unless the data-directory environment variables are overridden.

## Multi-school development notes

- Each account's active institution membership determines the school context for API access.
- A user with multiple active school memberships must select the intended school at login.
- The Platform Owner console is available at `/platform-owner`. Set `PLATFORM_OWNER_KEY` to a unique secret of at least 32 characters; never commit it or expose it in frontend code.
- School administrators create teacher/student accounts and issue guardian invitations from the People area.
- Guardian relationships must be verified by the school before an invitation is issued. The one-time invitation token is shown only once and must be shared privately.
- Run database migrations only against a backed-up development database. The existing SQLite database is the supported development database.

## Important deployment status

**MyClassroom is not yet certified or approved for onboarding live schools.** The current backend still uses SQLite and local disk storage. The asynchronous database interface is an incremental migration seam, not a PostgreSQL implementation. The storage interface currently has only a local provider. Do not deploy this version to a serverless platform or a multi-instance environment where local files may be ephemeral or unavailable to other instances.

Before a real-school launch, complete and verify all launch gates in [the production go-live checklist](docs/GO-LIVE-CHECKLIST.md). In particular:

1. Implement and test a PostgreSQL adapter and production migrations.
2. Implement private object storage with authenticated, short-lived downloads.
3. Replace browser local-storage bearer-token handling with a reviewed secure session design.
4. Configure and test password recovery email delivery and operational email.
5. Review upload content validation, malware scanning, backup/restore and retention.
6. Complete a full authorization and cross-tenant security review, including every remaining synchronous SQL route.
7. Complete accessibility, mobile-browser and end-to-end acceptance testing.
8. Configure production monitoring, alerting, incident response and school support.
9. Run a controlled staging pilot and obtain explicit release approval.

A single persistent Node.js instance with durable disk may be used for isolated development or staging only, with backups and no real student data. Vercel/serverless and horizontally scaled deployments are not supported by the current SQLite/local-storage implementation.

## Environment configuration

Copy `backend/.env.example` to `backend/.env` for local setup. Production secrets must be generated and stored in the hosting provider's secret manager. Never commit `.env`, JWT secrets, Platform Owner keys, passwords, invitation tokens or student data.

## Tests

```bash
cd backend
npm run check
npm test
```

The automated tests cover important repository contracts, runtime API flows, role authorization and tenant-isolation cases. Passing these tests is necessary but not sufficient for production readiness; see the go-live checklist.
