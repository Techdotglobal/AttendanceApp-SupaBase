# Department Usage Audit

Departments are organizational records. Department names are display values and
case-insensitive lookup inputs only; permissions control capabilities.

## Creation And Validation

- `services/auth-service/lib/orgNormalize.js`
  - `normalizeDepartmentName` preserves company-entered casing while collapsing whitespace.
  - `toLookupKey` produces lowercase `normalized_name` values for duplicate detection.
- `services/auth-service/lib/departmentService.js`
  - Lists tenant departments from `departments`.
  - Finds departments by `normalized_name`.
  - Ensures user-entered departments exist without changing display casing.
- `services/auth-service/routes/admin.js`
  - `POST /departments` and `PATCH /departments/:id` write `name` as entered and `normalized_name` as the case-insensitive key.
  - Duplicate normalized names return: `A department with this name already exists. Department names are case-insensitive.`

## Access Control And Permissions

- `services/auth-service/lib/permissions.js`
  - Manager capabilities are checked through `manager_permissions`.
  - `hasAnyPermission` supports permission-derived capability groups.
- `services/auth-service/lib/profileAccess.js`
  - Super admins are tenant-wide.
  - Managers are department-scoped unless routes pass `tenantWide: true` based on permissions.
- `services/auth-service/routes/admin.js`
  - Employee listing, analytics, profile edits, and role/status actions require explicit permissions.
  - Tenant-wide people access is derived from `create_user`, `delete_user`, `change_user_role`, or `approve_signup_requests`, not department names.
- `services/auth-service/routes/auth.js`
  - Username, email, delete, profile, role, and department updates use permission checks and tenant scope.
  - No backend permission branch depends on a department named `HR`.
- `apps/mobile/shared/constants/roles.js`
  - `isHRAdmin` is retained as a compatibility name, but now checks permission grants instead of department name.
- `apps/web/src/features/admin/pages/UsersPage.jsx`
  - Role/profile affordances use permission grants instead of department name.

## Employee Management

- `services/auth-service/routes/admin.js`
  - Users are scoped by `company_id`.
  - Managers without tenant-wide people permissions are filtered to their department.
  - User department updates call `ensureDepartmentForCompany`, linking `users.department_id` and legacy `users.department`.
- `apps/mobile/utils/employees.js`
  - Fetches manageable employees by tenant and manager scope.
  - Permission-elevated managers can manage non-super-admin users across the tenant.
  - Other managers are limited to non-manager employees in their own department.
- `apps/web/src/features/admin/pages/UsersPage.jsx`
  - Filters employees by department display name for UI filtering only.

## Leave Approvals

- `services/auth-service/routes/admin.js`
  - Leave list/process routes require leave permissions.
  - Managers are scoped to employees in their department.
- `apps/mobile/utils/leaveManagement.js`
  - Resolves leave category through tenant departments and stores department IDs where possible.
- `apps/mobile/screens/LeaveRequestScreen.js`
  - Displays and selects tenant department records.
- `apps/mobile/screens/EmployeeManagement.js` and `apps/mobile/screens/HRDashboard.js`
  - Process leave requests after permission checks and manager scope checks.

## Ticket Routing

- `apps/mobile/utils/ticketDepartments.js`
  - Resolves ticket categories against department IDs first, with legacy slug/name fallback.
  - Legacy labels such as `hr` are display compatibility only, not permission grants.
- `apps/mobile/utils/ticketManagement.js`
  - Routes new tickets to managers by selected department record.
  - Stores department IDs for new tickets.
  - Filters non-super-admin/non-tenant-wide managers by department relationship and assignment.
- `apps/mobile/screens/TicketScreen.js`, `TicketManagementScreen.js`, and `HRDashboard.js`
  - Display department labels from tenant department records.

## Analytics, Dashboard Filtering, And Reports

- `services/auth-service/routes/admin.js`
  - Analytics and dashboard stats require explicit permissions.
  - Department grouping uses `department_id` first and normalized legacy names only as compatibility fallback.
- `apps/web/src/features/admin/pages/AnalyticsPage.jsx`
  - Builds distribution from users and department overview returned by the API.
- `services/reporting-service/services/reportFormatter.js`
  - Groups already-provided employee rows by department display name for report output.
- `apps/mobile/utils/analytics.js` and `apps/mobile/screens/ReportsScreen.js`
  - Use department display values for grouping/report labels.

## Geofencing And Sites

- `services/auth-service/routes/admin.js`
  - Site creation/assignment requires geofencing permissions.
  - Managers are limited to their department record.
  - Employee-site assignment validates department relationship.
- `apps/mobile/features/geofencing/services/departmentGeofenceAccess.js`
  - Resolves department IDs, using normalized names only as legacy fallback.
- `apps/mobile/features/geofencing/services/geofenceService.js`
  - Uses department IDs for manager geofence access.

## Display-Only Usage

- Department names are displayed in user lists, dashboards, tickets, leave forms, manual attendance, settings, reports, and department overview screens.
- These display paths must not grant capabilities.
