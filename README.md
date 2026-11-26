# MyClassroom V12

A more complete full-stack starter for an online classroom and school-management platform.

## Included
- Admin, Teacher and Student portals
- Authentication, password change and reset-token architecture
- User/profile management
- Classes, enrolment codes and rosters
- Subjects and timetable
- Learning materials with optional local file upload
- Assignments and teacher grading
- Visual quiz/examination builder
- Server-side timed assessment attempts and automatic marking
- Results, gradebook, rankings and performance summaries
- Attendance marking with existing statuses loaded
- Notifications and announcements
- Teacher/student messaging
- Live-class links and scheduled live classes
- Print-ready report cards
- CSV gradebook export
- Admin school settings and audit log
- Responsive mobile-first interface

## Run
1. Install Node.js 18+.
2. Open a terminal in `backend`.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and change the secret.
5. Run `npm start`.
6. Open `http://localhost:3000`.

The backend serves the frontend, so one server is enough for local development.

## Important production notes
This is a deployable starter, not a hosted service. For production use HTTPS, PostgreSQL, a strong secret, secure HTTP-only cookie authentication, rate limiting, validation, backups, email delivery for password recovery, object storage/CDN for uploads, malware scanning, logging/monitoring and a real video provider such as Zoom, Google Meet, Microsoft Teams, Jitsi or WebRTC infrastructure.

Local uploads are intended for development. Password recovery email delivery is not configured; users must contact their school administrator.

The report card is print-ready HTML and can be saved as PDF from the browser print dialog.

## Multi-school foundation migration (development only)

The first tenant data-model migration is available as an explicit command:

```bash
cd backend
npm install
npm run migrate:tenant
```

It creates the institution and institution-membership tables, adds institution references to existing class, announcement, audit and settings records, and assigns the current single-school data to a `legacy-school` institution. The migration is idempotent and records its version in `schema_migrations`.

**Do not treat this migration as enabling multi-school production use.** The existing API routes have not yet been changed to enforce institution scope. Do not onboard a second school or expose real school data to another institution until tenant-aware authentication, query scoping, file access controls, and cross-institution isolation tests are implemented and reviewed. Back up the SQLite database before running this migration on any database containing data.
