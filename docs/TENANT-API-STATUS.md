# Tenant API implementation status

## Implemented in this change

- Authenticated sessions are bound to an active institution membership.
- Login can select an institution membership, and an authenticated user can switch to another active membership.
- School administrator, teacher and student permissions are resolved from the selected membership rather than relying only on a global user role.
- Class, roster, learning-content, assessment, result, attendance, announcement, messaging, reporting, settings and dashboard operations apply institution scope.
- Uploaded learning files are no longer exposed through a public static directory; downloads require authentication and class access.
- School settings use a composite institution/key primary key.
- Existing users and legacy data are assigned to the `legacy-school` institution at startup or through the ordered migrations.
- A GitHub Actions workflow checks JavaScript syntax on pull requests.

## Not yet ready for onboarding schools

This is not a production-ready multi-school release. The following remain before inviting a second institution:

1. Run the workflow and add integration tests that create two institutions and prove cross-institution read/write denial for every API route.
2. Add a platform-owner role and controlled institution provisioning/onboarding, invitations and membership management.
3. Audit global identity behavior when one email/user belongs to several institutions; add school-aware account administration and parent/guardian support.
4. Validate uploads by file type/content, size and malware scanning; move files to private object storage for production.
5. Review the SQLite deployment and persistence model; move production data to a managed relational database with backups.
6. Complete security review of password recovery, audit logging, account lifecycle, rate limits and production deployment settings.
7. Test the complete frontend flow for selecting/switching institutions and show the active institution in the interface.

## Release rule

Do not onboard a second real school or use real student records until the integration tests and security review above pass. The current registration page still creates accounts only in the initial legacy school; it is not an institution sign-up workflow.
