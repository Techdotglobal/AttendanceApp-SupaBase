# Hadir.AI Product Documentation and Detailed Use Cases

## 1. Document Purpose

This document provides:

- Comprehensive product documentation for the entire Hadir.AI system.
- Detailed use cases across all user roles and modules.
- A unified view of the mobile app, backend services, reporting service, and the web admin portal as an integrated module.

This is intended for product managers, engineering teams, QA, operations, and stakeholders onboarding to the platform.

---

## 2. Product Overview

Hadir.AI is a multi-tenant-ready employee attendance and workforce operations platform. It includes:

- **Mobile App (`apps/mobile`)** for employees, managers, and super admins.
- **Web Admin Portal (`apps/web`)** for administrative workflows and department-level operations.
- **API Gateway (`services/api-gateway`)** as the backend entrypoint.
- **Auth Service (`services/auth-service`)** for authentication and user/domain administration.
- **Reporting Service (`services/reporting-service`)** for scheduled and on-demand reporting.
- **Supabase** for authentication, PostgreSQL data, and realtime-enabled data operations.

Core business domains:

- Authentication and role-based access.
- Attendance tracking and analytics.
- Leave lifecycle management.
- Ticket routing and resolution.
- Department and site administration.
- Employee-to-site assignment controls.

---

## 3. Product Vision and Goals

### Vision

Provide a secure, reliable, and scalable workforce platform for attendance and operations management with strict role-based governance.

### Primary Goals

- Ensure trustworthy attendance records with clear auditability.
- Enable managers to govern only their departments.
- Enable super admins to perform global configuration and system operations.
- Keep business logic centralized and consistent across mobile and web clients.
- Maintain backward compatibility during data model migrations.

### Non-Goals

- Replacing Supabase with a custom authentication backend.
- Splitting business logic differently between clients.
- Supporting unrestricted cross-department manager operations.

---

## 4. Personas and Roles

### 4.1 Employee

- Uses mobile app for attendance, leave, and ticket actions.
- No web portal access.
- Can only access own records except where business visibility rules explicitly allow.

### 4.2 Manager

- Department-scoped operator.
- Can approve/reject department leave requests.
- Can view department attendance and department users.
- Can manage department sites and assignments.
- Cannot create/delete departments or create users.

### 4.3 Super Admin

- Full global operator.
- Can create/delete users.
- Can create/delete/rename departments.
- Can assign managers to departments.
- Has full visibility across attendance, leaves, users, sites, and analytics.

---

## 5. Module Map (Entire App)

### 5.1 Mobile App Module (`apps/mobile`)

Primary user-facing app for day-to-day operations:

- Login and session handling.
- Attendance check-in/check-out.
- Leave requests and balance visibility.
- Ticket creation and status tracking.
- Notification center.
- Personal and role-based dashboards.

### 5.2 Web Admin Portal Module (`apps/web`)

Administrative and governance portal:

- Role-based dashboard (super_admin vs manager).
- User management view and updates.
- Department management with counts and employee expansion.
- Site management and employee-site assignment.
- Attendance and leave administrative views.

### 5.3 API Gateway Module (`services/api-gateway`)

- Public backend entrypoint.
- Proxies auth and admin routes to service modules.
- Centralized CORS and request handling.

### 5.4 Auth Service Module (`services/auth-service`)

- Login/auth flows via Supabase.
- User CRUD and role updates.
- Admin APIs for departments/sites/assignments/attendance/leaves.
- Role enforcement and department scoping validation.

### 5.5 Reporting Service Module (`services/reporting-service`)

- Aggregated reports and scheduled generation.
- Query utilities and formatting.
- Optional email/report distribution pipelines.

### 5.6 Database and Security Module (Supabase)

- Supabase Auth for identity and sessions.
- PostgreSQL schema for domain entities.
- RLS policies for client-side safe access.
- Backend service-role operations for trusted server-side actions.

---

## 6. Key Business Rules

1. **Role-Based Access**
   - `super_admin`: full access.
   - `manager`: own department scope only.
   - `employee`: no web admin access.

2. **Department Governance**
   - Each user belongs to one department.
   - Managers can only govern employees/sites/leaves in their department.
   - Super admins can manage all departments and cross-department operations.

3. **Site Governance**
   - Department can have multiple sites.
   - Employee-site assignments must remain within the same department.
   - Cross-department assignment is invalid.

4. **Data Consistency**
   - Department naming must be normalized.
   - Duplicate semantic department names must be prevented.
   - Migration must preserve compatibility for legacy string-based department usage.

---

## 7. System Architecture Summary

Client-to-backend flow:

1. Mobile/Web clients call API Gateway.
2. API Gateway forwards to Auth Service and Reporting Service endpoints.
3. Auth Service performs role checks and domain validations.
4. Data persisted in Supabase PostgreSQL; auth managed by Supabase Auth.

Why this architecture:

- Single gateway for client integration.
- Centralized permission enforcement on backend.
- Keeps business logic out of clients where security-critical.

---

## 8. Data Model Summary

### Core Existing Tables

- `users`
- `attendance_records`
- `leave_requests`
- (ticket-related tables depending on migration history)

### Added/Extended Department & Site Domain

- `departments`
  - `id`, `name`, `created_at`
- `sites`
  - `id`, `name`, `latitude`, `longitude`, `radius`, `department_id`
- `employee_sites`
  - `id`, `employee_uid`, `site_id`, `created_at`

### Department Centralization Upgrade

- `users.department_id` added as canonical FK.
- `users.department` retained for backward compatibility.
- Sync trigger keeps both fields aligned during transition.

---

## 9. Security and RLS Strategy

### Server-Side Security

- Backend admin endpoints enforce role and scope checks.
- Manager actions are department constrained.
- Cross-department assignment and leave processing blocked.

### Database Security (RLS)

- RLS enabled for `departments`, `sites`, and `employee_sites`.
- Super admin: full access.
- Manager: own department scope.
- Employees: no admin-scope access.

### Practical Security Model

- Trusted backend uses service-role key for orchestrated operations.
- Client-facing direct table exposure protected by RLS.

---

## 10. Feature Documentation by Domain

### 10.1 Authentication and Session

- Login through gateway endpoint (`/api/auth/login`).
- Supports username/email with password.
- Session persistence handled via Supabase client.
- Role-based post-login routing:
  - super_admin -> admin dashboard
  - manager -> manager dashboard
  - employee -> mobile workflows only

### 10.2 Dashboarding

- Super admin: global employees/departments/active users/attendance/leaves.
- Manager: department-limited employee and leave/attendance insights.

### 10.3 User Management

- Super admin:
  - create, edit, activate/deactivate, role update, department update.
- Manager:
  - view and limited updates for own department users only.
  - cannot create/delete users.

### 10.4 Department Management

- Centralized department source of truth.
- Create, rename, delete with safeguards.
- Department overview includes:
  - active employee count,
  - manager (if assigned),
  - expandable employee list.

### 10.5 Site Management and Assignment

- Multi-site per department.
- Site geofence metadata: latitude/longitude/radius.
- Employee-site assignment restricted by department integrity rules.

### 10.6 Attendance Domain

- Check-in/check-out records with timestamp and context.
- Department-scoped admin visibility for managers.
- Full visibility for super admins.

### 10.7 Leave Domain

- Request lifecycle: pending -> approved/rejected.
- Manager approvals constrained to own department.
- Super admin can process all requests.

### 10.8 Ticket Domain

- Category/dept routing and assignment flows.
- Department governance applies to manager processing.
- Super admin fallback and oversight remain available.

---

## 11. Detailed Use Cases

### Format

- **Actor**
- **Preconditions**
- **Primary Flow**
- **Alternate/Exception Flow**
- **Postconditions**

---

### UC-01 Employee Login (Mobile)

- **Actor:** Employee
- **Preconditions:** Active user exists with valid credentials.
- **Primary Flow:**
  1. User enters username/email and password.
  2. App sends login request to gateway.
  3. Auth service validates credentials via Supabase Auth.
  4. User profile loaded from database.
  5. Employee dashboard opens.
- **Exceptions:**
  - Invalid credentials -> auth error message.
  - Service unavailable -> retry/fallback behavior.
- **Postconditions:** Authenticated session established.

### UC-02 Manager Login and Department-Scoped Access (Web)

- **Actor:** Manager
- **Preconditions:** Manager role with assigned department.
- **Primary Flow:**
  1. Manager logs in via web portal.
  2. Manager opens Users/Departments/Leaves.
  3. Backend returns only manager department data.
- **Exceptions:**
  - Requesting out-of-scope data -> 403 denied.
- **Postconditions:** Manager can operate only in allowed scope.

### UC-03 Super Admin Creates Department

- **Actor:** Super Admin
- **Preconditions:** Authenticated super_admin.
- **Primary Flow:**
  1. Opens Departments.
  2. Enters new name.
  3. Backend normalizes and creates unique record.
  4. Department appears in overview.
- **Exceptions:**
  - Duplicate normalized name -> conflict/error.
- **Postconditions:** Department available for user/site assignment.

### UC-04 Department Rename With Cascade Compatibility

- **Actor:** Super Admin
- **Preconditions:** Department exists.
- **Primary Flow:**
  1. Rename submitted in web UI.
  2. Backend updates `departments.name`.
  3. Backend updates linked `users.department` and `users.department_id`.
  4. Compatibility references are adjusted where applicable.
- **Exceptions:**
  - Invalid name -> validation error.
- **Postconditions:** Department name consistent across views and routing logic.

### UC-05 Department Deletion Safeguard

- **Actor:** Super Admin
- **Preconditions:** Department exists.
- **Primary Flow:**
  1. Admin attempts delete.
  2. Backend checks for active users in department.
  3. If none, delete allowed.
- **Exceptions:**
  - Active users exist -> delete blocked with explanatory error.
- **Postconditions:** Referential safety preserved.

### UC-06 Manager Approves Department Leave

- **Actor:** Manager
- **Preconditions:** Pending leave exists for manager department employee.
- **Primary Flow:**
  1. Manager opens Leaves.
  2. Approves or rejects pending request.
  3. Backend validates department scope.
  4. Status updated with processing metadata.
- **Exceptions:**
  - Leave outside manager department -> denied.
  - Already processed leave -> invalid state error.
- **Postconditions:** Leave state transitioned safely.

### UC-07 Super Admin Global Leave Processing

- **Actor:** Super Admin
- **Preconditions:** Any pending leave exists.
- **Primary Flow:** Same as UC-06 without department constraints.
- **Postconditions:** Global administrative override possible.

### UC-08 Manager Creates Site in Own Department

- **Actor:** Manager
- **Preconditions:** Manager department mapping exists.
- **Primary Flow:**
  1. Manager fills site details.
  2. Backend validates `department_id` belongs to manager department.
  3. Site created.
- **Exceptions:**
  - Department mismatch -> denied.
- **Postconditions:** New site available for assignment in manager scope.

### UC-09 Employee-Site Assignment Integrity

- **Actor:** Manager or Super Admin
- **Preconditions:** Employee and site exist.
- **Primary Flow:**
  1. Assignment request sent.
  2. Backend compares employee department vs site department.
  3. Assignment inserted only if same department.
- **Exceptions:**
  - Cross-department attempt -> rejected.
- **Postconditions:** No cross-department site assignments.

### UC-10 Department Overview with Expandable Employees

- **Actor:** Manager or Super Admin
- **Preconditions:** Authenticated admin user.
- **Primary Flow:**
  1. User opens Departments page.
  2. UI fetches departments overview endpoint.
  3. Cards render name, active count, manager.
  4. Expanding card shows employee list (name, role, position).
- **Exceptions:**
  - If centralized table absent/empty, backend fallback derives from `users.department`.
- **Postconditions:** Departments visible with people data in one view.

### UC-11 Attendance View by Role

- **Actor:** Manager or Super Admin
- **Preconditions:** Attendance records exist.
- **Primary Flow:**
  - Manager sees own department attendance only.
  - Super admin sees all attendance.
- **Postconditions:** Compliance with role and scope rules.

### UC-12 Migration Compatibility Validation

- **Actor:** DevOps/Engineer
- **Preconditions:** Migrations applied in sequence.
- **Primary Flow:**
  1. Run schema migrations for departments/sites and centralization.
  2. Run RLS migration.
  3. Validate counts, links, and policy status.
- **Postconditions:** New model active without breaking legacy flows.

---

## 12. Operational Runbook (Release and Validation)

### Migration Execution Order

1. `019_create_departments_sites_employee_sites.sql`
2. `020_centralize_departments_on_users.sql`
3. `022_enable_rls_departments_sites.sql`

### Service Restart Order (Local)

1. `services/auth-service`
2. `services/api-gateway`
3. `apps/web` (or hard-refresh Vite)

### Production Deployment Pattern

1. Merge/push to repository.
2. Redeploy backend services on Render.
3. Deploy/update web app on Vercel (`apps/web` root).
4. Smoke-test:
   - login,
   - departments overview,
   - role-filtered leaves/attendance,
   - site assignment integrity.

---

## 13. Environment and Integration Reference

### Web (`apps/web`)

- `VITE_API_GATEWAY_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Auth Service (`services/auth-service`)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT`

### API Gateway (`services/api-gateway`)

- `AUTH_SERVICE_URL`
- `REPORTING_SERVICE_URL` (if reporting enabled)

---

## 14. Risks and Mitigations

- **Risk:** Department rename breaks legacy references.
  - **Mitigation:** Backward-compatible updates and sync trigger.
- **Risk:** Managers access cross-department data.
  - **Mitigation:** Backend scope checks + RLS.
- **Risk:** Migration order errors.
  - **Mitigation:** Explicit runbook and idempotent scripts.
- **Risk:** Inconsistent department naming.
  - **Mitigation:** Normalization function and centralized table.

---

## 15. Future Roadmap Suggestions

- Add manager assignment table for one-to-many manager-to-department relationship with audit history.
- Add soft-delete and archival strategy for departments and sites.
- Add comprehensive audit log for all admin mutations.
- Add automated post-migration integrity checks and CI SQL validation.
- Add tenant isolation columns and policies for full multi-company onboarding scale.

---

## 16. Appendix: Quick QA Checklist

- [ ] Login works for employee/manager/super_admin.
- [ ] Employee blocked from web admin portal.
- [ ] Manager sees only own department in departments overview.
- [ ] Super admin sees all departments.
- [ ] Department card expands with employee list.
- [ ] Rename department keeps users and views consistent.
- [ ] Delete blocked when active users exist.
- [ ] Site creation and assignment blocked across departments.
- [ ] Leave processing is role-correct and scoped.
- [ ] RLS enabled on departments/sites/employee_sites.

---

**Document version:** 1.0  
**Scope:** Entire Hadir.AI platform including Web Admin Portal module  
**Owner:** Engineering/Product Team
