# MyClassroom multi-school platform architecture

## Product direction

MyClassroom is a multi-tenant learning and school-management SaaS. The first launch market is Nigeria; the product must be localisable for later international use. It will support primary schools, secondary schools, and tertiary institutions without assuming that every institution uses the same academic structure.

The existing V12 application is the starting point. Preserve useful classroom, assessment, attendance, messaging, results, and reporting workflows while evolving the data model and security model deliberately.

## Tenancy and institution model

- A **platform owner** operates the SaaS, onboards institutions, manages platform-wide configuration, support, plans, and subscription status.
- A **school/institution** is one tenant. It owns its branding, academic calendar, classes/programmes, subjects/courses, staff, learners, guardians, settings, and records.
- A person is a global account and may hold memberships in more than one institution. Their role and permissions are scoped to a membership, not inferred from a global role alone.
- Every tenant-owned record must carry a non-null `school_id` (or be reachable through a tenant-owned parent record with an enforced tenant-safe relationship). Every read and write must be scoped to the authenticated active school.
- Never trust a client-supplied `school_id` as proof of access. Resolve the active school from a validated membership and enforce it server-side.
- Platform-owner operations are explicitly separate from school-level operations and must be audited.

## Institution types and academic flexibility

Support institution categories: `primary`, `secondary`, `tertiary`, and `other`. Avoid hard-coding only Nigerian class labels such as JSS/SSS. Use configurable academic structures:

- Academic years and terms/semesters
- Departments, faculties, programmes, levels, classes/cohorts and course/subject offerings
- Enrolments and course registrations
- Configurable grading scales and assessment weights
- Institution-specific calendars, attendance rules, currencies, time zones and grading labels

A primary/secondary school may organise learners by class and arm; a tertiary institution may organise learners by faculty, department, programme, level and course registration. Both should use shared, reusable learning, assessment, attendance and reporting services where appropriate.

## Roles and permission boundaries

- Platform owner: platform-wide tenant lifecycle and subscription administration.
- School owner/school administrator: institution settings, staff, learners, academic structure and reports for their own tenant.
- Teacher/lecturer: assigned classes or course offerings only.
- Student/learner: their own profile and enrolled learning spaces.
- Parent/guardian: explicitly linked learner records and only the information granted by the institution.
- Optional bursar, registrar, librarian and support roles should be introduced through granular permissions rather than broad admin access.

A user may have different roles in different schools. Permission checks must include the school membership and the resource relationship.

## Data and infrastructure direction

1. Move from local SQLite to managed PostgreSQL before onboarding real institutions. Keep SQLite useful for local development only if the data-access layer remains compatible.
2. Use database migrations and a documented migration path from the current single-school V12 data.
3. Prefer relational tenant scoping, foreign keys and unique constraints that include `school_id`. Consider PostgreSQL row-level security as defence in depth, not as a replacement for application authorisation.
4. Move uploads to private object storage. Issue short-lived, permission-checked download URLs; validate file size and type and scan uploads.
5. Use an email provider for verification and password recovery. Do not expose reset tokens in API responses.
6. Add rate limiting, secure headers, strict CORS allowlists, structured logs, backups, monitoring and restore drills.
7. Use a real video provider for live classes; store provider references, not arbitrary trusted executable embeds.
8. Keep secrets in environment variables or a secrets manager. Fail startup in production if required secrets are absent.

## Nigeria-first, international-ready

- Store timestamps in UTC and render using each institution's IANA time zone.
- Store currency per institution; default new Nigerian institutions to NGN, but do not hard-code naira into business logic.
- Make phone numbers, addresses, date formats, language and academic labels configurable.
- Design payment integration behind a provider abstraction. Do not assume a single payment provider or currency.
- Plan for applicable Nigerian privacy and child-protection obligations, and review the legal requirements of each future launch country before expansion.

## Migration principles

- Do not retrofit tenant IDs with ad-hoc SQL updates in production.
- First create a migration plan and automated backup/restore path.
- Introduce the first institution record and map all existing V12 records to that institution in a controlled migration.
- Add tenant-aware constraints and indexes, then update every API query and write path.
- Verify isolation with automated tests that create two schools and attempt cross-school access for every major resource type.
- Keep the current production branch unchanged until the migration is reviewed and tested.

## Definition of done for multi-tenancy

- A user cannot read, update, delete, export, message or enumerate another school's records by changing IDs or request parameters.
- Teachers are limited to their assigned offerings/classes within the active school.
- Students and guardians are limited to their own permitted records.
- Platform-owner actions are explicitly authorised and audited.
- Automated cross-tenant isolation tests pass for all tenant-owned resources.
- A migration from the V12 single-school dataset is repeatable and has a tested rollback/restore procedure.
