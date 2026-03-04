# Modular Architecture Guide

## Overview

This document describes the modular architecture of the Attendance App, designed for maintainability, scalability, and deployment readiness.

## Directory Structure

```
AttendanceApp/
├── apps/
│   └── mobile/                     # React Native Expo app
│       ├── App.js                  # Main app entry point
│       ├── app.json                # Expo configuration
│       ├── package.json            # Dependencies
│       └── ...                     # All mobile app code
│
├── services/                       # Microservices
│   ├── api-gateway/                # API Gateway service (port 3000)
│   ├── auth-service/               # Authentication service (port 3001)
│   ├── attendance-service/         # Placeholder for attendance service
│   ├── leave-service/              # Placeholder for leave service
│   └── ticket-service/             # Placeholder for ticket service
│
├── App.js                          # Legacy (moved to apps/mobile/)
├── app.json                        # Legacy (moved to apps/mobile/)
├── package.json                    # Legacy (moved to apps/mobile/)
│
├── core/                           # Core application infrastructure
│   ├── config/                     # Configuration files
│   │   └── supabase.js            # Supabase configuration
│   ├── contexts/                   # React Context providers
│   │   ├── AuthContext.js         # Authentication context
│   │   └── ThemeContext.js        # Theme context
│   ├── navigation/                 # Navigation setup
│   │   ├── AppNavigator.js        # Main navigation logic
│   │   ├── AuthNavigator.js       # Auth flow navigation
│   │   └── MainNavigator.js       # Main app navigation
│   └── services/                   # External services
│       └── storage.js             # Storage abstraction layer
│
├── features/                       # Feature modules (self-contained)
│   ├── auth/                       # ✅ Authentication feature (PARTIALLY MIGRATED)
│   │   ├── services/              # Auth services
│   │   │   └── authService.js    # Auth business logic (Supabase integration)
│   │   ├── utils/                 # Auth utilities
│   │   │   ├── biometricAuth.js
│   │   │   └── authPreferences.js
│   │   └── index.js               # Feature exports (public API)
│   │
│   └── calendar/                   # ✅ Calendar feature (PARTIALLY MIGRATED)
│       └── components/
│           └── DatePickerCalendar.js
│
│   # ⏳ PENDING MIGRATION (currently in screens/ and utils/):
│   # - attendance/ (screens: EmployeeDashboard, AttendanceHistory, ManualAttendanceScreen)
│   # - tickets/ (screens: TicketScreen, TicketManagementScreen)
│   # - leave/ (screens: LeaveRequestScreen)
│   # - employees/ (screens: EmployeeManagement, CreateUserScreen, SignupApprovalScreen)
│   # - notifications/ (screens: NotificationsScreen)
│   # - analytics/ (screens: AdminDashboard, HRDashboard)
│
├── shared/                         # Shared code across features
│   ├── components/                 # Reusable UI components
│   │   ├── Logo.js
│   │   ├── Trademark.js
│   │   └── CustomDrawer.js
│   ├── hooks/                      # Shared hooks
│   │   └── useResponsive.js
│   ├── utils/                      # Shared utilities
│   │   ├── responsive.js
│   │   ├── export.js
│   │   └── storage.js
│   ├── constants/                  # Constants and enums
│   │   ├── roles.js
│   │   ├── workModes.js
│   │   └── routes.js
│   └── types/                      # Type definitions (JSDoc)
│
├── screens/                        # ⚠️ Legacy screens (CURRENTLY IN USE - to be migrated)
│   ├── LoginScreen.js             # Auth screen (legacy)
│   ├── SignUpScreen.js            # Auth screen (legacy)
│   ├── ForgotPasswordScreen.js    # Password reset request screen
│   ├── ResetPasswordScreen.js     # Password reset completion screen
│   ├── EmployeeDashboard.js       # Attendance screen (legacy)
│   ├── AdminDashboard.js          # Analytics screen (legacy)
│   ├── HRDashboard.js             # Analytics screen (legacy)
│   ├── AttendanceHistory.js       # Attendance screen (legacy)
│   ├── AuthenticationScreen.js    # Auth screen (legacy)
│   ├── AuthMethodSelection.js     # Auth screen (legacy)
│   ├── LeaveRequestScreen.js      # Leave screen (legacy)
│   ├── CalendarScreen.js          # Calendar screen (legacy)
│   ├── ThemeSettingsScreen.js     # Settings screen (includes password change UI)
│   ├── NotificationsScreen.js     # Notifications screen (legacy)
│   ├── TicketScreen.js            # Tickets screen (legacy)
│   ├── TicketManagementScreen.js  # Tickets screen (legacy)
│   ├── ManualAttendanceScreen.js  # Attendance screen (legacy)
│   ├── EmployeeManagement.js      # Employees screen (legacy)
│   ├── CreateUserScreen.js        # Employees screen (legacy)
│   ├── SignupApprovalScreen.js    # Employees screen (legacy)
│   └── HelpSupportScreen.js      # Help & Support (production-safe email, fallback modal)
│
├── utils/                          # ⚠️ Legacy utils (CURRENTLY IN USE - to be migrated)
│   ├── auth.js                    # Auth utils (legacy - use features/auth instead)
│   ├── passwordChange.js          # Password change utility (Supabase Auth integration)
│   ├── employees.js               # Employee utils (legacy)
│   ├── ticketManagement.js        # Ticket utils (legacy)
│   ├── leaveManagement.js         # Leave utils (legacy)
│   ├── notifications.js           # Notification utils (legacy)
│   ├── analytics.js               # Analytics utils (legacy)
│   ├── calendar.js                # Calendar utils (uses Supabase calendar_events table)
│   ├── location.js                # Location utils (legacy)
│   ├── export.js                  # Export utils (legacy)
│   ├── storage.js                 # Storage utils (legacy - use core/services/storage)
│   ├── responsive.js              # Responsive utils (legacy - use shared/utils/responsive)
│   ├── biometricAuth.js           # Biometric utils (legacy - use features/auth/utils)
│   ├── authPreferences.js         # Auth preferences (legacy - use features/auth/utils)
│   ├── faceVerification.js        # Face verification (legacy)
│   ├── signupRequests.js          # Signup utils (legacy)
│   ├── workModes.js               # Work mode utils (legacy - use shared/constants/workModes)
│   ├── hrRoles.js                 # HR roles utils (legacy)
│   └── expoGoDetection.js         # Expo Go detection (legacy)
│
├── components/                     # ⚠️ Legacy components (CURRENTLY IN USE - to be migrated)
│   ├── CustomDrawer.js            # Drawer component (legacy - use shared/components)
│   ├── Logo.js                    # Logo component (legacy - use shared/components)
│   ├── Trademark.js               # Trademark component (legacy - use shared/components)
│   └── DatePickerCalendar.js      # Calendar component (legacy - use features/calendar)
│
├── scripts/                        # Build and deployment scripts
│   └── create-users-supabase.js
│
├── docs/                           # Documentation
│   ├── MODULAR_ARCHITECTURE.md
│   ├── SYSTEM_ARCHITECTURE.md
│   └── EAS_BUILD_SETUP.md
│
└── .github/                        # GitHub workflows (CI/CD)
    └── workflows/
        └── deploy.yml              # Build and deploy workflow with npm ci fixes
```

## Principles

### 1. Feature-Based Modules
Each feature is self-contained with:
- **Screens**: UI components for the feature
- **Components**: Feature-specific reusable components
- **Hooks**: Custom React hooks for feature logic
- **Services**: Business logic and API calls
- **Utils**: Feature-specific utilities
- **index.js**: Public API for the feature

### 2. Dependency Rules
- ✅ Features can import from `shared/` and `core/`
- ✅ Features can import from other features via their `index.js`
- ❌ Features should NOT directly import from other features' internals
- ❌ Shared code should NOT import from features

### 3. Separation of Concerns
- **Screens**: Presentation logic only
- **Services**: Business logic, data operations
- **Hooks**: State management, side effects
- **Utils**: Pure functions, helpers
- **Components**: Reusable UI elements

### 4. Deployment Structure
- Configuration files at root level
- Build scripts in `scripts/`
- CI/CD workflows in `.github/workflows/`
- Documentation in `docs/`

## Current Migration Status

### ✅ Completed
- **Core Infrastructure**: `core/` directory fully implemented
  - ✅ Supabase configuration (`core/config/supabase.js`)
  - ✅ Context providers (`core/contexts/AuthContext.js`, `ThemeContext.js`)
  - ✅ Navigation setup (`core/navigation/`)
  - ✅ Storage service (`core/services/storage.js`)
  - ✅ Deep linking support (`AppNavigator.js` handles `hadirai://reset-password`)
- **Shared Code**: `shared/` directory fully implemented
  - ✅ Shared components (`shared/components/`)
  - ✅ Shared constants (`shared/constants/`) - includes `FORGOT_PASSWORD` and `RESET_PASSWORD` routes
  - ✅ Shared utilities (`shared/utils/`)
- **Partial Feature Migration**:
  - ✅ `features/auth/` - Auth service and utilities migrated
  - ✅ `features/calendar/` - Calendar component migrated
  - ⚠️ Auth screens still in `screens/` (LoginScreen, SignUpScreen, ForgotPasswordScreen, ResetPasswordScreen, etc.)
  - ⚠️ Calendar screen still in `screens/CalendarScreen.js`
- **New Features Added**:
  - ✅ Password change utility (`utils/passwordChange.js`)
  - ✅ Forgot password screen (`screens/ForgotPasswordScreen.js`)
  - ✅ Reset password screen (`screens/ResetPasswordScreen.js`)
  - ✅ Password change UI in Theme Settings screen
  - ✅ Calendar events Supabase integration (`utils/calendar.js`)

### 🔄 In Progress
- **Feature Modules**: Most features still need migration
  - ⏳ Attendance feature (screens in `screens/`, utils in `utils/`)
  - ⏳ Tickets feature (screens in `screens/`, utils in `utils/`)
  - ⏳ Leave feature (screens in `screens/`, utils in `utils/`)
  - ⏳ Employees feature (screens in `screens/`, utils in `utils/`)
  - ⏳ Notifications feature (screens in `screens/`, utils in `utils/`)
  - ⏳ Analytics feature (screens in `screens/`, utils in `utils/`)

### ⏳ Pending
- Complete feature module migrations
- Update all imports to use feature modules
- Remove legacy code from `screens/`, `utils/`, `components/`
- Create feature `index.js` files for all features
- Migrate screens to feature directories

## Migration Strategy

1. **Phase 1**: ✅ Create new structure alongside existing code (COMPLETED)
2. **Phase 2**: 🔄 Migrate features one by one (IN PROGRESS - auth partially done)
3. **Phase 3**: ⏳ Update imports gradually (PENDING)
4. **Phase 4**: ⏳ Remove legacy code (PENDING)

## Current Import Patterns

### ✅ Using New Structure
```javascript
// Core contexts
import { useAuth } from '../core/contexts/AuthContext';
import { useTheme } from '../core/contexts/ThemeContext';

// Shared constants
import { ROLES } from '../shared/constants/roles';
import { WORK_MODES } from '../shared/constants/workModes';
import { ROUTES } from '../shared/constants/routes';

// Shared components
import Logo from '../shared/components/Logo';
import CustomDrawer from '../shared/components/CustomDrawer';

// Auth feature (migrated)
import { authenticateUser, createUser } from '../features/auth';

// Core services
import { storage } from '../core/services/storage';
```

### ⚠️ Still Using Legacy Structure
```javascript
// Legacy screens (to be migrated)
import EmployeeDashboard from '../screens/EmployeeDashboard';
import AttendanceHistory from '../screens/AttendanceHistory';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';

// Legacy utils (to be migrated)
import { checkIn, checkOut } from '../utils/auth';
import { changePassword } from '../utils/passwordChange';
import { getEmployees } from '../utils/employees';
import { createTicket } from '../utils/ticketManagement';
import { createCalendarEvent, getCalendarEvents } from '../utils/calendar';
```

## Benefits

1. **Maintainability**: Clear feature boundaries
2. **Scalability**: Easy to add new features
3. **Testability**: Isolated modules are easier to test
4. **Team Collaboration**: Multiple developers can work on different features
5. **Deployment**: Clear structure for CI/CD pipelines
6. **Code Reuse**: Shared code in one place

## CI/CD Pipeline

The project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that:

- **Builds on**: Push/PR to `master` or `main` branches
- **Environment**: Ubuntu latest with Node.js 18
- **Steps**:
  1. Checkout code
  2. Setup Node.js with npm caching
  3. Verify npm version
  4. Validate package-lock.json structure
  5. Install dependencies (with fallback to regenerate lockfile if corrupted)
  6. Run linter (optional)
  7. Check code formatting (optional)
  8. Build Android app
  9. Build iOS app

**Features**:
- Automatic package-lock.json validation
- Fallback to regenerate lockfile if npm ci fails
- Environment variable support (EXPO_PUBLIC_ENV)
- Graceful error handling for optional steps

## Notes

- **Navigation**: Currently imports screens from `screens/` directory (legacy)
  - Includes new screens: `ForgotPasswordScreen`, `ResetPasswordScreen`
  - Deep linking configured in `AppNavigator.js` for password reset flow
- **App.js**: Still imports from `utils/employees` (legacy)
- **Most screens**: Still located in `screens/` directory (20 screens total, including new password screens)
- **Most utils**: Still located in `utils/` directory (18+ utility files, including `passwordChange.js`)
- **Calendar Events**: Stored in Supabase `calendar_events` table with visibility (`all`, `none`, `selected`); migration `019_add_calendar_event_visibility.sql`; refresh on screen focus.
- **Password Management**: Uses Supabase Auth only (no local storage)
- **Super Admin Manual Attendance**: Super admins see all active employees (no role filter); see `utils/employees.js` `getManageableEmployees`.
- **Migration is gradual**: New code should use feature modules, legacy code will be migrated over time
- **CI/CD**: GitHub Actions workflow configured for automated builds and deployments

