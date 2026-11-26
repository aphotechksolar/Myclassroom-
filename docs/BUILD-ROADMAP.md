# MyClassroom delivery roadmap

## Product commitment

Build a multi-school online learning and school-management platform for primary, secondary and tertiary institutions. Launch in Nigeria first, while designing for international localisation. Evolve V12 incrementally; do not replace working features without a reason.

## Phase 0 — Baseline and safety

- Inventory all routes, tables, frontend portals, dependencies and deployment assumptions.
- Establish automated tests and repeatable local setup.
- Remove public demo credentials and demo seeding from production behaviour.
- Fix authentication, password reset, input validation, upload validation, CORS and security headers.
- Document existing V12 behaviour and identify authorisation gaps.
- Decide and test the target persistent hosting, PostgreSQL and object-storage services.

**Exit gate:** a reproducible build/test process, documented security findings, no production demo credentials, and a safe migration/backup plan.

## Phase 1 — Multi-school foundation

- Add institution onboarding and platform-owner controls.
- Introduce schools, memberships, scoped roles and active-school context.
- Migrate existing V12 data into a default institution.
- Add tenant scope to all academic and communication data.
- Add two-school isolation tests before enabling additional institutions.

**Exit gate:** automated tests prove that cross-school access is denied for every tenant-owned resource.

## Phase 2 — Academic model for all levels

- Add configurable academic years and terms/semesters.
- Support primary/secondary classes and arms.
- Support tertiary faculties, departments, programmes, levels and course registrations.
- Add configurable grading scales and assessment policies.
- Preserve the existing class, subject, assignment and examination experience through the new academic model.

**Exit gate:** pilot institutions from different education levels can configure their academic structures without code changes.

## Phase 3 — Learning and school operations

- Improve teacher/lecturer and learner portals.
- Complete attendance, assignments, examinations, marking, gradebooks and report cards.
- Add guardian accounts and controlled learner linking.
- Add announcements, notifications and secure messaging.
- Improve mobile usability, accessibility and low-bandwidth performance.

**Exit gate:** complete end-to-end workflows tested with representative staff, learner and guardian accounts.

## Phase 4 — SaaS operations

- School onboarding and verification.
- Subscription plans, billing lifecycle and payment-provider abstraction.
- School branding, domain/subdomain strategy and configurable settings.
- Platform support tools, audit trails, backups and monitoring.

**Exit gate:** an institution can onboard, configure, operate and manage its subscription without manual database intervention.

## Phase 5 — Nigeria pilot and international expansion

- Pilot with a small number of Nigerian institutions across the target education levels.
- Validate onboarding, training, support, pricing, data protection and operational reliability.
- Add localisation and country-specific payment/compliance work before entering each new market.

**Exit gate:** pilot feedback is addressed, recovery procedures are tested, and operational ownership is documented.

## Working rules

- Work on feature branches and review changes before merging to `main`.
- Prefer small, testable pull requests over a single large rewrite.
- Never use real student data in development fixtures.
- Never deploy schema changes without a backup and rollback plan.
- Do not claim a feature is production-ready until its permissions, validation, tests and operational requirements are covered.
