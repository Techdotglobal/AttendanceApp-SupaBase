# System Architecture & User Management Guide

## Table of Contents
1. [Overview](#overview)
2. [Code Architecture](#code-architecture)
3. [Microservices Architecture](#microservices-architecture)
4. [Authentication System](#authentication-system)
5. [User Roles & Permissions](#user-roles--permissions)
6. [Employee Data Structure](#employee-data-structure)
7. [Supabase Integration](#supabase-integration)
8. [Ticket Routing System](#ticket-routing-system)
9. [Data Storage](#data-storage)
10. [Login Flow](#login-flow)
11. [Employee Management](#employee-management)

---

## Overview

This attendance management system uses **Supabase Authentication** and **PostgreSQL** for user management, with **AsyncStorage** for local data persistence. The system supports three authentication roles with different permission levels and automatic ticket routing based on departments.

The codebase follows a **modular, feature-based architecture** where each feature is self-contained and isolated, ensuring features don't interfere with each other and the code is deployment-ready.

---

## Microservices Architecture

### Overview

The application has been restructured into a **microservices architecture** with a monorepo structure:

```
AttendanceApp/
├── apps/
│   └── mobile/              # React Native Expo app
│
└── services/
    ├── api-gateway/        # API Gateway service (port 3000)
    ├── auth-service/       # Authentication service (port 3001)
    ├── attendance-service/ # Placeholder for attendance service
    ├── leave-service/      # Placeholder for leave service
    └── ticket-service/     # Placeholder for ticket service
```

### API Gateway Service

**Location:** `services/api-gateway/`

**Purpose:** Single entry point for all client requests, routing them to appropriate microservices.

**Features:**
- Express server running on port 3000
- Health check endpoint (`/health`)
- Auth routes that forward requests to auth-service
- CORS enabled for cross-origin requests
- Error handling for service unavailability
- Request timeout handling (10 seconds)

**Endpoints:**
- `GET /health` - Health check
- `POST /api/auth/login` - Forward to auth-service
- `GET /api/auth/check-username/:username` - Forward to auth-service
- `POST /api/auth/users` - Forward to auth-service
- `PATCH /api/auth/users/:username/role` - Forward to auth-service
- `PATCH /api/auth/users/:username` - Forward to auth-service

### Auth Service

**Location:** `services/auth-service/`

**Purpose:** Handles all authentication and user management logic.

**Architecture:**
- **Supabase Client**: Used for all database operations and authentication
- **Service Role Key**: Used for backend operations (bypasses Row Level Security)
- **Supabase Auth**: Handles authentication and password verification

**Why This Approach?**
- Supabase provides unified client for both Auth and Database
- Service Role Key allows backend to perform admin operations
- Supabase Auth handles password verification natively

**Features:**
- Express server running on port 3001
- Supabase Client integration with service role key
- Secure password verification using Supabase Auth
- Complete user management endpoints

**Login Flow:**
1. Accept username/email + password
2. If username: Query Supabase PostgreSQL to get email
3. Authenticate: Use Supabase Auth (`signInWithPassword`)
4. If correct: Query Supabase PostgreSQL to get user data
5. Return user info or authentication error

**Endpoints:**
- `GET /health` - Health check
- `POST /api/auth/login` - User authentication with password verification
- `GET /api/auth/check-username/:username` - Username availability check
- `POST /api/auth/users` - User creation
- `PATCH /api/auth/users/:username/role` - Role updates
- `PATCH /api/auth/users/:username` - User info updates

**Configuration:**
- Supabase credentials via environment variables:
  - `SUPABASE_URL` - Your Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for backend operations)

**Security:**
- ✅ Passwords verified server-side using Supabase Auth
- ✅ Database access uses Service Role Key (trusted backend, bypasses RLS)
- ✅ No passwords stored or logged
- ✅ Proper error handling for all authentication failures
- ✅ Row Level Security (RLS) policies for frontend access

### Frontend Integration

**Location:** `apps/mobile/`

**API Gateway Configuration:** `apps/mobile/core/config/api.js`

**Login Flow:**
1. Frontend calls API Gateway (`/api/auth/login`)
2. API Gateway forwards to Auth Service
3. Auth Service authenticates via Supabase and returns user data
4. If API Gateway fails: Falls back to direct Supabase authentication (backward compatibility)

**Platform-Aware URL Configuration:**
- **iOS Simulator**: `http://localhost:3000`
- **Android Emulator**: `http://10.0.2.2:3000`
- **Physical Device**: Configured in `app.json` as `http://<your-computer-ip>:3000` (e.g., `http://192.168.18.38:3000`)
- **Configuration**: Set in `apps/mobile/app.json` under `extra.apiGatewayUrl`

**Deep Linking Configuration:**
- **Scheme**: `hadirai` (configured in `app.json`)
- **Password Reset URL**: `hadirai://reset-password`
- **Supabase Redirect URL**: Configured in `app.json` under `extra.supabaseRedirectUrl`
- **Deep Link Handling**: Implemented in `AppNavigator.js` using `Linking` API

### Service Startup

**Windows (PowerShell):**
```powershell
.\start-services.ps1
```

**Linux/macOS (Bash):**
```bash
./start-services.sh
```

**Manual Startup:**
```bash
# Terminal 1: API Gateway
cd services/api-gateway
npm start

# Terminal 2: Auth Service
cd services/auth-service
npm start
```

### Future Services

- **Attendance Service**: Handle attendance tracking and records
- **Leave Service**: Manage leave requests and balances
- **Ticket Service**: Handle support ticket system

---

## Code Architecture

### Modular Structure

The application is organized into three main layers:

#### 1. Core (`core/`)
Core infrastructure that the entire app depends on:
- **`config/`**: Supabase and app configuration
- **`contexts/`**: React Context providers (Auth, Theme)
- **`navigation/`**: Navigation setup and routing
- **`services/`**: Core services (storage abstraction)

#### 2. Features (`features/`)
Self-contained feature modules (PARTIALLY MIGRATED):

**✅ Migrated Features:**
- **`auth/`**: Authentication service and utilities
  - `services/authService.js` - Supabase authentication logic
  - `utils/biometricAuth.js` - Biometric authentication
  - `utils/authPreferences.js` - Auth preferences
  - `index.js` - Public API exports
  - ⚠️ Screens still in `screens/` (LoginScreen, SignUpScreen, AuthenticationScreen, AuthMethodSelection)

- **`calendar/`**: Calendar component
  - `components/DatePickerCalendar.js` - Calendar picker component
  - ⚠️ Screen still in `screens/CalendarScreen.js`

**⏳ Pending Migration (currently in `screens/` and `utils/`):**
- **`attendance/`**: Attendance tracking (screens: EmployeeDashboard, AttendanceHistory, ManualAttendanceScreen)
- **`tickets/`**: Ticket management (screens: TicketScreen, TicketManagementScreen)
- **`leave/`**: Leave request management (screens: LeaveRequestScreen)
- **`employees/`**: Employee management (screens: EmployeeManagement, CreateUserScreen, SignupApprovalScreen)
- **`notifications/`**: Notification system (screens: NotificationsScreen)
- **`analytics/`**: Analytics and dashboards (screens: AdminDashboard, HRDashboard)

**Note**: Most screens and utilities are still in legacy `screens/` and `utils/` directories. Migration is ongoing.

#### 3. Shared (`shared/`)
Reusable code across features:
- **`components/`**: Reusable UI components (Logo, Trademark, etc.)
- **`utils/`**: Shared utilities (responsive, export)
- **`constants/`**: Constants and enums (roles, workModes, routes)
- **`hooks/`**: Shared React hooks

### Architecture Benefits

1. **Feature Isolation**: Changes to one feature don't affect others
2. **Clear Dependencies**: Features only import from `shared/` and `core/`
3. **Deployment Ready**: Clear structure for CI/CD pipelines
4. **Maintainability**: Easy to find and modify code by feature
5. **Scalability**: Easy to add new features without affecting existing ones

### Import Patterns

#### ✅ New Structure (Use for New Code)
```javascript
// Import from features (migrated)
import { authenticateUser, createUser } from '../features/auth';

// Import from shared
import { ROLES } from '../shared/constants/roles';
import { WORK_MODES } from '../shared/constants/workModes';
import { ROUTES } from '../shared/constants/routes';
import Logo from '../shared/components/Logo';

// Import from core
import { useAuth } from '../core/contexts/AuthContext';
import { useTheme } from '../core/contexts/ThemeContext';
import { storage } from '../core/services/storage';
```

#### ⚠️ Legacy Structure (Currently Used - Will Be Migrated)
```javascript
// Legacy screens (currently used by navigation)
import EmployeeDashboard from '../screens/EmployeeDashboard';
import AttendanceHistory from '../screens/AttendanceHistory';

// Legacy utils (currently used by screens)
import { checkIn, checkOut } from '../utils/auth';
import { getEmployees } from '../utils/employees';
import { createTicket } from '../utils/ticketManagement';
import { submitLeaveRequest } from '../utils/leaveManagement';
```

### Navigation Structure

- **`AppNavigator.js`**: Main router that decides between auth and main navigation
- **`AuthNavigator.js`**: Handles login/signup flow
- **`MainNavigator.js`**: Routes based on user role (employee, manager, super_admin)

For detailed architecture documentation, see `docs/MODULAR_ARCHITECTURE.md`.

---

## Authentication System

### How Authentication Works

1. **User Login Process:**
   - User enters username or email + password
   - System checks if input is username (no `@`) or email
   - If username: Queries Supabase PostgreSQL to find user's email
   - Authenticates with Supabase Auth using email + password
   - Retrieves user data from Supabase PostgreSQL
   - Combines with employee data from AsyncStorage (if available)
   - Sets user session in AuthContext

2. **Authentication Methods:**
   - **Username Login**: `testuser` → System finds email → Supabase Auth
   - **Email Login**: `testuser@company.com` → Direct Supabase Auth

3. **Password Storage:**
   - Passwords are **NOT stored in PostgreSQL** (security best practice)
   - Passwords are hashed and stored in **Supabase Authentication**
   - Cannot retrieve original passwords (by design)

4. **Password Change:**
   - Users can change their own password via Theme Settings screen
   - Requires re-authentication with current password before changing
   - Uses Supabase Auth `signInWithPassword` for verification
   - Uses Supabase Auth `updateUser` to set new password
   - No password data stored locally or in PostgreSQL
   - Self-service only (no admin password resets)

5. **Forgot Password Flow:**
   - Users can request password reset via Forgot Password screen
   - Uses Supabase Auth `resetPasswordForEmail` to send reset email
   - Deep linking configured: `hadirai://reset-password`
   - Email link opens app and navigates to Reset Password screen
   - Supabase handles token generation, validation, and session creation
   - Users set new password via `updateUser` API
   - Generic success message prevents email enumeration

---

## User Roles & Permissions

### Role Hierarchy

The system has **3 authentication roles** (not position-based):

#### 1. `super_admin`
**Full System Access**

**Permissions:**
- ✅ Create new users
- ✅ Approve signup requests
- ✅ Manage all employees (all departments)
- ✅ Access all dashboards
- ✅ View all attendance records
- ✅ Assign tickets manually
- ✅ System administration
- ✅ Can manage managers and super admins
- ✅ Manual attendance: sees all active employees (including other super admins; no role filter)

**Example Users:**
- `testadmin` (System Administrator)

#### 2. `manager`
**Department-Level Access**

**Permissions:**
- ✅ Manage employees in their department only
- ✅ View attendance records
- ✅ Access HR dashboard
- ✅ Approve leave requests (their department)
- ✅ View tickets assigned to them
- ✅ Cannot manage super admins
- ❌ Cannot create users
- ❌ Cannot approve signups

**Example Users:**
- `hrmanager` (HR Department)
- `techmanager` (Engineering Department)
- `salesmanager` (Sales Department)

**How Managers are Identified:**
- Role: `manager`
- Department: `HR`, `Engineering`, `Sales`, etc.
- Username can be anything (e.g., `hrmanager`, `techmanager`)

#### 3. `employee`
**Basic Access**

**Permissions:**
- ✅ Check in/out
- ✅ View own attendance records
- ✅ Create tickets
- ✅ Request leave/work mode changes
- ✅ View own profile
- ❌ Cannot manage other employees
- ❌ Cannot view other employees' data
- ❌ Cannot access admin dashboards

**Example Users:**
- `testuser`, `john.doe`, `jane.smith`, etc.

### Role vs Position

**Important Distinction:**

- **Role** (`role` field): Authentication/access control
  - Values: `super_admin`, `manager`, `employee`
  - Controls what you can do in the system

- **Position** (`position` field): Job title/description
  - Values: `AI Engineer`, `Senior AI Engineer`, `AI Intern`, `HR Manager`, etc.
  - Descriptive only, does NOT control access
  - Used for HR hierarchy mapping

**Example:**
```json
{
  "username": "techmanager",
  "role": "manager",           // ← Controls access
  "position": "Engineering Manager",  // ← Just a title
  "department": "Engineering"
}
```

---

## Employee Data Structure

### Complete User Object

Every user/employee has the following structure:

```json
{
  "id": "emp_001",                    // Unique employee ID
  "uid": "supabase_auth_uid",         // Supabase Authentication UID
  "username": "testuser",             // Login username (unique)
  "email": "testuser@company.com",    // Email (unique, for Supabase Auth)
  "name": "Test User",                // Full name
  "role": "employee",                 // Auth role: super_admin, manager, employee
  "department": "Engineering",        // Department name
  "position": "AI Engineer",          // Job title/position
  "workMode": "in_office",            // in_office, semi_remote, fully_remote
  "hireDate": "2023-01-15",          // YYYY-MM-DD format
  "isActive": true,                   // Active status
  "createdAt": "2023-01-15T00:00:00.000Z",
  "updatedAt": "2023-01-15T00:00:00.000Z"
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique employee identifier (e.g., `emp_001`) |
| `uid` | string | Yes* | Supabase Auth UID |
| `username` | string | Yes | Login username, must be unique |
| `email` | string | Yes | Email address, must be unique, used for Supabase Auth |
| `name` | string | Yes | Full name of the employee |
| `role` | string | Yes | `super_admin`, `manager`, or `employee` |
| `department` | string | No | Department name (e.g., `Engineering`, `HR`, `Sales`) |
| `position` | string | No | Job title (e.g., `AI Engineer`, `HR Manager`) |
| `workMode` | string | No | `in_office`, `semi_remote`, or `fully_remote` |
| `hireDate` | string | No | Date in `YYYY-MM-DD` format |
| `isActive` | boolean | Yes | Whether employee is active |
| `createdAt` | string | Yes | ISO 8601 timestamp |
| `updatedAt` | string | Yes | ISO 8601 timestamp |

---

## Supabase Integration

### Overview

The application uses **Supabase** as the primary backend service for authentication and user data management. Supabase provides secure, scalable PostgreSQL database and authentication capabilities for the attendance management system.

### Supabase Services Used

1. **Supabase Authentication** - User authentication and session management
2. **PostgreSQL Database** - SQL database for user profiles and data
3. **Row Level Security (RLS)** - Database-level access control

### Supabase Configuration

The Supabase configuration is located in `core/config/supabase.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Custom AsyncStorage adapter for session persistence
const AsyncStorageAdapter = {
  getItem: async (key) => await AsyncStorage.getItem(key),
  setItem: async (key, value) => await AsyncStorage.setItem(key, value),
  removeItem: async (key) => await AsyncStorage.removeItem(key),
};

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

**Key Features:**
- **AsyncStorage Persistence**: Auth state persists across app restarts via custom adapter
- **PostgreSQL Database**: Relational database with SQL queries
- **Error Handling**: Graceful fallbacks if initialization fails
- **Deep Linking**: Configured for password reset flow (`hadirai://reset-password`)

### Supabase Authentication

#### What is Stored in Supabase Auth?

- **Email**: Used as the primary login identifier
- **Password**: Hashed and encrypted (not retrievable)
- **UID**: Unique user identifier (used as `uid` field in PostgreSQL `users` table)
- **Session State**: Automatically managed by Supabase

#### Authentication Methods Supported

1. **Email/Password Authentication** (Primary)
   - Users can login with email or username
   - If username is provided, system looks up email in PostgreSQL
   - Password is verified by Supabase Authentication

2. **Password Change** (Self-Service)
   - Available in Theme Settings screen
   - Requires current password verification
   - Uses `signInWithPassword` for re-authentication
   - Uses `updateUser` to set new password
   - No admin password resets allowed

3. **Password Reset** (Forgot Password Flow)
   - Users request reset via Forgot Password screen
   - Supabase sends email with reset link
   - Deep link opens app: `hadirai://reset-password`
   - Supabase handles token validation and session creation
   - Users set new password via Reset Password screen

4. **Session Persistence**
   - Uses AsyncStorage for offline persistence via custom adapter
   - Automatically restores session on app restart
   - `onAuthStateChange` listener updates app state

#### Authentication Flow

**Frontend Flow (with API Gateway):**
```javascript
// 1. User enters username or email
authenticateUser(usernameOrEmail, password)

// 2. Try API Gateway first
try {
  const response = await fetch(`${API_GATEWAY_URL}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ usernameOrEmail, password })
  });
  
  if (response.ok) {
    // API Gateway authentication successful
    return response.json();
  }
} catch (error) {
  // Fallback to direct Supabase authentication
}

// 3. Fallback: Direct Supabase authentication
const { data, error } = await supabase.auth.signInWithPassword({
  email: email,
  password: password,
});
```

**Backend Flow (Auth Service):**
```javascript
// 1. Accept username/email + password
POST /api/auth/login

// 2. If username, resolve email using Supabase PostgreSQL
if (!usernameOrEmail.includes('@')) {
  const { data: userData } = await supabase
    .from('users')
    .select('email')
    .eq('username', usernameOrEmail)
    .single();
  email = userData.email;
}

// 3. Authenticate using Supabase Auth
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: email,
  password: password,
});

// 4. If password correct, get user data from PostgreSQL
const { data: userData } = await supabase
  .from('users')
  .select('*')
  .eq('uid', authData.user.id)
  .single();

// 5. Return user info
return { success: true, user: userData };
```

#### Authentication Error Handling

The system handles various Supabase Auth errors:

- `Invalid login credentials`: User doesn't exist or wrong password
- `Email not confirmed`: Email needs verification
- `Email rate limit exceeded`: Too many login attempts
- `User already registered`: Email already exists
- `Invalid email address`: Invalid email format

### PostgreSQL Database

#### Table Structure

**Users Table:**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid UUID UNIQUE NOT NULL,  -- Supabase Auth UID
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL,  -- 'employee', 'manager', 'super_admin'
  department VARCHAR(255),
  position VARCHAR(255),
  work_mode VARCHAR(50),  -- 'in_office', 'semi_remote', 'fully_remote'
  hire_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Calendar Events Table:**
```sql
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  time TIME,
  type VARCHAR(50) DEFAULT 'other',
  color VARCHAR(7) DEFAULT '#3b82f6',
  created_by_uid UUID,
  created_by VARCHAR(255),
  visibility VARCHAR(20) DEFAULT 'all',  -- 'all', 'none', 'selected'
  visible_to JSONB DEFAULT '[]'::jsonb,  -- Array of usernames/UIDs
  assigned_to JSONB DEFAULT '[]'::jsonb,  -- Legacy field (backward compatibility)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Important Notes:**
- **UID Field**: Stores Supabase Auth UID (not the primary key)
- **Username Field**: Unique identifier for login
- **Email Field**: Must match Supabase Auth email
- **Role Field**: Controls access (`super_admin`, `manager`, `employee`)
- **Snake_case**: Database uses snake_case (e.g., `work_mode`, `hire_date`)
- **Calendar Events**: Stored in Supabase (not AsyncStorage), supports visibility settings

#### Row Level Security (RLS)

**RLS Policies:**
- Backend uses Service Role Key (bypasses RLS)
- Frontend uses Anon Key (respects RLS policies)
- Policies control read/write access based on authentication and roles

**Example RLS Policy:**
```sql
-- Allow users to read their own data
CREATE POLICY "Users can read own data"
ON users FOR SELECT
USING (auth.uid() = uid);

-- Allow super_admin to read all
CREATE POLICY "Super admins can read all"
ON users FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE uid = auth.uid() AND role = 'super_admin'
  )
);
```

### Supabase API Usage

#### Creating Users

```javascript
// 1. Create in Supabase Auth (using Admin API on backend)
const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
  email: email,
  password: password,
  email_confirm: true,
});

// 2. Create PostgreSQL record
const { data: userData, error: dbError } = await supabase
  .from('users')
  .insert({
    uid: authUser.user.id,
    username: username,
    email: email,
    name: name,
    role: role,
    department: department,
    position: position,
    work_mode: workMode,
    hire_date: hireDate,
    is_active: true,
  })
  .select()
  .single();
```

#### Querying Users

```javascript
// Find user by username
const { data: userData } = await supabase
  .from('users')
  .select('*')
  .eq('username', username)
  .single();

// Get user by UID
const { data: userData } = await supabase
  .from('users')
  .select('*')
  .eq('uid', uid)
  .single();
```

#### Updating Users

```javascript
// Update user role
const { data, error } = await supabase
  .from('users')
  .update({ 
    role: newRole,
    updated_at: new Date().toISOString()
  })
  .eq('username', username)
  .select();

// Update multiple fields
const { data, error } = await supabase
  .from('users')
  .update({
    department: newDepartment,
    position: newPosition,
    work_mode: newWorkMode,
    updated_at: new Date().toISOString()
  })
  .eq('username', username)
  .select();
```

### Supabase Authentication State Management

The app uses `onAuthStateChange` listener to track authentication state:

```javascript
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      // User is signed in
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('uid', session.user.id)
        .single();
      setUser(userData);
    } else {
      // User is signed out
      setUser(null);
    }
  });

  return () => subscription.unsubscribe();
}, []);
```

### What Goes to Supabase?

#### ✅ Stored in Supabase

1. **Supabase Authentication**
   - Email addresses
   - Hashed passwords
   - User UIDs
   - Session tokens

2. **PostgreSQL `users` Table**
   - Complete user profiles
   - Username, email, name
   - Role, department, position
   - Work mode, hire date
   - Active status
   - Timestamps

### What Does NOT Go to Supabase?

#### ❌ Stored Locally (AsyncStorage)

- **Attendance Records**: `@attendance_records`
- **Tickets**: `@tickets`
- **Notifications**: `@notifications`
- **Signup Requests**: `@signup_requests`
- **Leave Requests**: `@leave_requests`
- **Employee List Cache**: `@company_employees` (synced from Supabase)

#### ✅ Stored in Supabase (Cloud)

- **Calendar Events**: `calendar_events` table
  - Events stored in Supabase PostgreSQL
  - AsyncStorage used only as fallback if Supabase unavailable
  - Supports visibility settings: `all`, `none`, `selected`
  - Row Level Security (RLS) policies control access
  - Events refresh on screen focus for data consistency

**Why?**
- Attendance and tickets are device-specific
- Notifications are local to each device
- Reduces database read/write costs
- Faster local access

### Supabase Implementation

The app uses Supabase as the primary backend service:

**Current Architecture:**
- Supabase Authentication for user management
- PostgreSQL SQL database for data storage
- Supabase Client SDK for all database operations
- Row Level Security (RLS) for data access control

#### User Management Scripts

User creation scripts available:
- **`scripts/create-users-supabase.js`** - Programmatically create users via Supabase Admin API
- **`scripts/create-new-users-automated.js`** - Automated user creation script

### Supabase Best Practices

1. **Security**
   - Use Row Level Security (RLS) policies in production
   - Never expose Service Role Key in client code (use environment variables)
   - Implement proper role-based access control
   - Use Anon Key for frontend, Service Role Key for backend only

2. **Performance**
   - Use PostgreSQL indexes for frequently queried fields
   - Cache frequently accessed data in AsyncStorage
   - Implement pagination for large datasets
   - Use `.select()` to limit returned fields

3. **Error Handling**
   - Always handle Supabase errors gracefully
   - Check both `data` and `error` in responses
   - Provide user-friendly error messages
   - Log errors for debugging

4. **Offline Support**
   - Supabase Auth persists via AsyncStorage adapter
   - AsyncStorage provides additional offline storage
   - Implement local caching for offline access

### Supabase Troubleshooting

#### Common Issues

**1. "Missing or insufficient permissions"**
- Check Row Level Security (RLS) policies
- Verify policies are enabled on the table
- Ensure user is authenticated
- Check if Service Role Key is needed for backend operations

**2. "Supabase client not initialized"**
- Check `core/config/supabase.js` initialization
- Verify environment variables are set
- Ensure Supabase URL and keys are correct

**3. "User not found"**
- Check if user exists in Supabase Authentication
- Verify PostgreSQL `users` table has matching record
- Check `uid` field matches Supabase Auth UID
- Verify username field matches

**4. Authentication not persisting**
- Verify AsyncStorage is working
- Check AsyncStorage adapter is configured correctly
- Ensure app has storage permissions
- Verify `autoRefreshToken` and `persistSession` are enabled

### Supabase Setup Reference

For complete setup instructions, see:
- **`SETUP.md`** - Step-by-step Supabase setup guide
- **`core/config/supabase.js`** - Supabase configuration file
- **`services/auth-service/config/supabase.js`** - Backend Supabase configuration
- **`apps/mobile/utils/auth.js`** - Authentication service implementation

---

## Ticket Routing System

### How Tickets are Routed

When a user creates a ticket:

1. **Category Selection:**
   - User selects category: `Technical`, `HR`, `Finance`, `Facilities`, or `Other`

2. **Super Admin Notification:**
   - All super admins receive notification immediately
   - Ticket is visible to super admins in dashboard

3. **Automatic Department Routing:**
   - System maps category to department:
     - `Technical` → `Engineering` → Finds `techmanager`
     - `HR` → `HR` → Finds `hrmanager`
     - `Finance` → `Finance` → Finds Finance manager (if exists)
     - `Facilities` → `Facilities` → Finds Facilities manager (if exists)
     - `Other` → No auto-assignment (super admin only)

4. **Auto-Assignment:**
   - If department manager exists:
     - Ticket automatically assigned to that manager
     - Status changes from `open` to `in_progress`
     - Manager receives notification
   - If no manager found:
     - Ticket remains unassigned
     - All managers notified about unassigned ticket

### Category to Department Mapping

```javascript
{
  "engineering": "Engineering",  // → Engineering Manager
  "technical": "Technical",       // → Technical Manager (separate department)
  "hr": "HR",                    // → HR Manager
  "finance": "Finance",          // → Finance Manager
  "sales": "Sales",              // → Sales Manager
  "other": null                  // → No auto-assignment (super admin only)
}
```

**Important:** Engineering and Technical are **separate departments** with separate managers:
- Engineering category routes to Engineering Manager
- Technical category routes to Technical Manager
- Each has its own department and manager

### Ticket Flow Example

**Scenario 1:** Employee creates an Engineering ticket

1. Employee creates ticket with category `Engineering`
2. Super admin gets notification
3. System finds `Engineering` department
4. System finds manager with `role: "manager"` AND `department: "Engineering"` → Engineering Manager
5. Ticket auto-assigned to Engineering Manager
6. Engineering Manager receives notification
7. Ticket status: `in_progress`

**Scenario 2:** Employee creates a Technical ticket

1. Employee creates ticket with category `Technical`
2. Super admin gets notification
3. System finds `Technical` department
4. System finds manager with `role: "manager"` AND `department: "Technical"` → Technical Manager
5. Ticket auto-assigned to Technical Manager
6. Technical Manager receives notification
7. Ticket status: `in_progress`

---

## Data Storage

### Storage Locations

#### 1. Supabase (Cloud)
- **Authentication**: Email/password credentials via Supabase Auth
- **PostgreSQL `users` table**: Complete user profile data
- **Database**: PostgreSQL with Row Level Security (RLS) policies

#### 2. AsyncStorage (Local Device)
- **Key**: `@company_employees`
- **Data**: Array of employee objects (same structure as PostgreSQL)
- **Purpose**: Local cache, offline access, employee management

#### 3. AsyncStorage (Other Data)
- **Key**: `@attendance_records` - Attendance data
- **Key**: `@tickets` - Ticket data
- **Key**: `@notifications` - Notification data
  - Structure: Array of notification objects
  - Each notification includes:
    - `id`: Unique identifier
    - `recipientUsername`: Target user
    - `title`: Notification title
    - `body`: Notification message
    - `type`: Notification type (ticket_created, leave_request, etc.)
    - `data`: Additional data including navigation payload
    - `read`: Boolean read state (legacy)
    - `isRead`: Boolean read state (primary)
    - `readAt`: ISO timestamp when marked as read
    - `createdAt`: ISO timestamp when created
  - State Management:
    - Default state: All new notifications have `isRead: false`
    - Dual fields (`read` and `isRead`) for backward compatibility
    - Persistence verification: All write operations verify by reading back
    - Badge count: Only counts notifications where `!read && !isRead`
  - Operations:
    - `markNotificationAsRead(id)`: Marks single notification as read with verification
    - `markAllNotificationsAsRead(username)`: Marks all user notifications as read
    - `clearReadNotifications(username)`: Removes only read notifications, preserves unread
    - `getUnreadNotificationCount(username)`: Returns count of unread notifications
  - Navigation:
    - Centralized navigation handler: `handleNotificationNavigation()`
    - Role-aware routing based on notification type and user role
    - Automatic read marking after successful navigation
    - Safe navigation with fallbacks to prevent crashes
- **Key**: `@signup_requests` - Pending signup requests

### Data Synchronization

- **Supabase** is the source of truth for user authentication and data
- **AsyncStorage** employee list is synced with Supabase PostgreSQL
- When user is created:
  1. Created in Supabase Authentication
  2. Record created in PostgreSQL `users` table
  3. Employee added to AsyncStorage `@company_employees`

---

## Login Flow

### Architecture Overview

The login flow uses a **microservices architecture** with API Gateway and Auth Service. The frontend first attempts to authenticate via the API Gateway, with a fallback to direct Supabase authentication for backward compatibility.

### Step-by-Step Process (Microservices Architecture)

```
1. User enters username/email + password (Frontend)
   ↓
2. Frontend calls API Gateway: POST /api/auth/login
   ↓
3. API Gateway forwards to Auth Service: POST /api/auth/login
   ↓
4. Auth Service:
   a. If username → Query Supabase PostgreSQL → Get email
   b. Verify password using Supabase Auth (signInWithPassword)
   c. If correct → Get user data from Supabase PostgreSQL
   d. Return user object
   ↓
5. API Gateway returns response to Frontend
   ↓
6. If API Gateway fails → Fallback to direct Supabase authentication
   ↓
7. Set user in AuthContext
   ↓
8. Navigate to appropriate dashboard:
    - employee → EmployeeDashboard
    - manager/super_admin → AdminDashboard
```

### Frontend Login Flow

**Location:** `apps/mobile/utils/auth.js`

**Flow:**
1. User enters username/email + password
2. Frontend calls API Gateway (`/api/auth/login`) with 10-second timeout
3. If API Gateway succeeds → Use response
4. If API Gateway fails (network error, timeout, service unavailable) → Fallback to direct Supabase authentication
5. Maintains backward compatibility

**Code:**
```javascript
// Try API Gateway first
try {
  const response = await fetch(`${API_GATEWAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail, password }),
    signal: controller.signal, // 10-second timeout
  });
  
  if (response.ok) {
    return await response.json(); // API Gateway success
  }
} catch (error) {
  // Fallback to Supabase authentication
}

// Fallback: Direct Supabase authentication
const { data, error } = await supabase.auth.signInWithPassword({
  email: email,
  password: password,
});
```

### Backend Login Flow (Auth Service)

**Location:** `services/auth-service/routes/auth.js`

**Flow:**
1. Accept username/email + password
2. **If username**: Query Supabase PostgreSQL by `username` field → Get email
3. **Verify password**: Use Supabase Auth (`signInWithPassword`)
4. **If password correct**: Query Supabase PostgreSQL to get user data
5. Return user info or authentication error

**Why This Approach?**
- Supabase provides unified client for both Auth and Database
- Service Role Key allows backend to perform admin operations (bypasses RLS)
- Supabase Auth handles password verification natively
- Single client simplifies code and reduces dependencies

**Code:**
```javascript
// 1. If username, resolve email using Supabase
if (!usernameOrEmail.includes('@')) {
  const { data: userData } = await supabase
    .from('users')
    .select('email')
    .eq('username', usernameOrEmail)
    .single();
  email = userData.email;
}

// 2. Verify password using Supabase Auth
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: email,
  password: password,
});

if (authError) {
  return { success: false, error: authError.message };
}

// 3. Get user data from PostgreSQL
const { data: userData } = await supabase
  .from('users')
  .select('*')
  .eq('uid', authData.user.id)
  .single();

// 4. Return user info
return { success: true, user: userData };
```

### Username vs Email Login

**Username Login:**
1. Frontend sends username to API Gateway
2. Auth Service queries PostgreSQL by `username` field using Supabase
3. Gets email from PostgreSQL record
4. Authenticates using Supabase Auth
5. Returns user data from PostgreSQL

**Email Login:**
1. Frontend sends email to API Gateway
2. Auth Service uses email directly
3. Authenticates using Supabase Auth
4. Returns user data from PostgreSQL

**Key Differences:**
- Username login requires PostgreSQL query BEFORE password verification
- Email login skips PostgreSQL query (uses email directly)
- Both use Supabase Auth for password verification
- Both use Service Role Key for database access (trusted backend, bypasses RLS)
- No RLS restrictions (Service Role Key bypasses policies)

### Security Features

**✅ Secure Password Verification:**
- Passwords verified server-side using Supabase Auth
- No passwords stored or logged
- Proper error handling for authentication failures

**✅ Trusted Backend:**
- Service Role Key used for PostgreSQL operations
- Admin privileges for database access
- Bypasses Row Level Security (RLS) policies

**✅ Error Handling:**
- Invalid username/email → 401
- Invalid password → 401
- User disabled → 403
- Too many attempts → 429
- Network errors → 503 (service unavailable)

### Fallback Authentication

If the API Gateway is unavailable, the frontend automatically falls back to direct Supabase authentication:

```javascript
// Fallback: Direct Supabase authentication
try {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });
  // ... get user data from PostgreSQL
} catch (error) {
  // Handle authentication error
}
```

This ensures the app continues to work even if microservices are down.

---

## Employee Management

### Creating Employees

**Who can create:**
- `super_admin` only

**Process:**
1. Super admin fills form (username, password, name, email, role, department, position, etc.)
2. System checks if username exists
3. Creates user in Supabase Authentication (via Admin API)
4. Creates record in PostgreSQL `users` table
5. Adds employee to AsyncStorage `@company_employees`
6. If role is `manager`, can manage employees in their department

### Updating Employees

**Who can update:**
- `super_admin`: Can update anyone
- `manager`: Can update employees in their department only

**Fields that can be updated:**
- Role (super_admin only)
- Department
- Position
- Work mode
- Hire date
- Active status

### Employee Roles by Department

**Engineering Department:**
- Manager: Engineering Manager (role: `manager`, department: `Engineering`)
- Employees: All employees with `department: "Engineering"`

**Technical Department:**
- Manager: Technical Manager (role: `manager`, department: `Technical`)
- Employees: All employees with `department: "Technical"`
- **Note:** Technical is a separate department from Engineering, each with its own manager

**HR Department:**
- Manager: `hrmanager` (role: `manager`, department: `HR`)
- Employees: All employees with `department: "HR"`

**Sales Department:**
- Manager: `salesmanager` (role: `manager`, department: `Sales`)
- Employees: All employees with `department: "Sales"`

**Finance Department:**
- Manager: Finance Manager (role: `manager`, department: `Finance`)
- Employees: All employees with `department: "Finance"`

---

## Key Concepts Summary

### 1. Authentication Roles (3 total)
- `super_admin`: Full access
- `manager`: Department-level access
- `employee`: Basic access

### 2. Position vs Role
- **Role**: Controls access (`super_admin`, `manager`, `employee`)
- **Position**: Job title (`AI Engineer`, `HR Manager`, etc.) - descriptive only

### 3. Department-Based Routing
- Managers identified by: `role: "manager"` + `department: "X"`
- Tickets routed to managers based on category-to-department mapping
- Leave requests routed to managers based on category-to-department mapping
- Engineering and Technical are separate departments with separate managers
- Managers can only manage employees in their department
- Work Mode Distribution statistics filtered by department for managers

### 4. Supabase Structure
- **Authentication**: Email/password (hashed, stored in Supabase Auth)
- **PostgreSQL**: User profile data (no passwords, `uid` field = Supabase Auth UID)
- **Configuration**: `core/config/supabase.js` (frontend), `services/auth-service/config/supabase.js` (backend)
- **Initialization**: AsyncStorage persistence via custom adapter
- **Security**: Row Level Security (RLS) policies for role-based access

### 5. Data Flow
- Login → Supabase Auth → PostgreSQL → AsyncStorage (optional)
- Create User → Supabase Auth + PostgreSQL + AsyncStorage
- Tickets → AsyncStorage → Auto-route to department manager

---

## Example User Scenarios

### Scenario 1: Employee Login
```
Username: testuser
Password: testuser123
→ Role: employee
→ Department: Engineering
→ Position: AI Engineer
→ Dashboard: EmployeeDashboard
→ Can: Check in/out, view own attendance, create tickets
```

### Scenario 2: Manager Login
```
Username: techmanager
Password: techmanager123
→ Role: manager
→ Department: Engineering
→ Position: Engineering Manager
→ Dashboard: AdminDashboard
→ Can: Manage Engineering employees, view tickets assigned to them
```

### Scenario 3: Super Admin Login
```
Username: testadmin
Password: testadmin123
→ Role: super_admin
→ Department: Management
→ Position: System Administrator
→ Dashboard: AdminDashboard
→ Can: Everything (create users, manage all employees, assign tickets)
```

---

## Migration from users.txt

If migrating from `users.txt` format:

```
Format: username,password:xxx,role:xxx
Example: testuser,password:testuser123,role:employee
```

**Migration Process:**
1. Parse `users.txt` file (if migrating from legacy format)
2. For each user:
   - Create in Supabase Authentication (email + password)
   - Create record in PostgreSQL `users` table
   - Add to AsyncStorage `@company_employees`
3. Use user creation script: `scripts/create-users-supabase.js` or automated script: `scripts/create-new-users-automated.js`

---

## Troubleshooting

### Common Issues

**1. "Missing or insufficient permissions" error:**
- **Cause**: Row Level Security (RLS) policies are blocking access
- **For Username Login**: Policies must allow queries before authentication
- **For Email Login**: Policies must allow authenticated users to read their own data
- **Solution**: Update RLS policies or use Service Role Key for backend operations
- See `SETUP.md` for complete RLS policy setup

**2. "User not found" error:**
- **For Username Login**: User doesn't exist in PostgreSQL `users` table
- **For Email Login**: User exists in Supabase Auth but PostgreSQL record is missing
- **Solution**: 
  - Check if user exists in both Supabase Authentication AND PostgreSQL
  - Run migration script if database is empty: `scripts/create-users-supabase.js`
  - Users must exist in BOTH places for login to work

**3. "User data not found" error:**
- **Cause**: User authenticated successfully in Supabase Auth, but PostgreSQL record doesn't exist
- **Solution**: Create the PostgreSQL record with the user's UID in the `uid` field
- This happens when users are created in Supabase Auth but not in PostgreSQL

**4. "Invalid password" error:**
- Password is stored in Supabase Auth (hashed)
- Cannot retrieve original password
- Use Supabase Dashboard to reset password

**5. Empty PostgreSQL Database:**
- **Username Login**: Will fail immediately with "Invalid username or password"
- **Email Login**: Will authenticate in Supabase Auth, but fail when reading PostgreSQL with "User data not found"
- **Solution**: Populate database using migration script or create users through the app

**6. Ticket not routing to manager:**
- Verify manager exists with correct `role: "manager"`
- Verify manager's `department` matches ticket category mapping
- Check if manager is `isActive: true`

**7. Manager cannot manage employees:**
- Verify manager's `department` matches employee's `department`
- Check if manager's `role` is `"manager"` (not `"employee"`)
- Verify employee is not a `super_admin` (managers can't manage super admins)

---

## Best Practices

1. **Always use Supabase as source of truth** for authentication
2. **Keep AsyncStorage synced** with PostgreSQL for offline access
3. **Use department field** to identify managers, not username
4. **Position is descriptive only** - don't use for access control
5. **Role determines permissions** - always check `role` field for access control
6. **Tickets auto-route** - ensure managers have correct department
7. **Use Service Role Key** only on backend, never expose in frontend

---

## File References

### Data Structure Examples
- **User Data Structure**: `users.json`, `asyncStorage-users-example.json`

### Documentation
- **Modular Architecture**: `docs/MODULAR_ARCHITECTURE.md`
- **Setup Guide**: `SETUP.md`
- **EAS Build Setup**: `apps/mobile/EAS_BUILD_SETUP.md`
- **Technical Documentation**: `docs/TECHNICAL_DOCUMENTATION.md`

### Code Locations (Current Structure)

#### ✅ New Modular Structure (Migrated)
- **Auth Service**: `features/auth/services/authService.js`
- **Auth Feature**: `features/auth/index.js`
- **Auth Utils**: `features/auth/utils/biometricAuth.js`, `features/auth/utils/authPreferences.js`
- **Calendar Component**: `features/calendar/components/DatePickerCalendar.js`
- **Password Change Utility**: `utils/passwordChange.js`
- **Core Auth Context**: `core/contexts/AuthContext.js`
- **Core Theme Context**: `core/contexts/ThemeContext.js`
- **Core Navigation**: `core/navigation/AppNavigator.js`, `core/navigation/MainNavigator.js`, `core/navigation/AuthNavigator.js`
- **Core Storage**: `core/services/storage.js`
- **Core Supabase Config**: `core/config/supabase.js` (frontend)
- **Backend Supabase Config**: `services/auth-service/config/supabase.js` (backend)
- **Shared Constants**: `shared/constants/roles.js`, `shared/constants/workModes.js`, `shared/constants/routes.js`
- **Shared Components**: `shared/components/Logo.js`, `shared/components/Trademark.js`, `shared/components/CustomDrawer.js`
- **Shared Utils**: `shared/utils/responsive.js`

#### ⚠️ Legacy Code (Currently in Use - Being Migrated)
- **Legacy Auth Utils**: `utils/auth.js` (use `features/auth` instead)
- **Password Change Utility**: `utils/passwordChange.js` (secure password change via Supabase Auth)
- **Legacy Employee Utils**: `utils/employees.js` (to be migrated to `features/employees/`)
- **Legacy Ticket Utils**: `utils/ticketManagement.js` (to be migrated to `features/tickets/`)
- **Legacy Leave Utils**: `utils/leaveManagement.js` (to be migrated to `features/leave/`)
- **Calendar Utils**: `utils/calendar.js` (uses Supabase `calendar_events` table, AsyncStorage fallback)
- **Notification Utils**: `utils/notifications.js`
  - Centralized notification creation and persistence
  - Read state management with dual fields (`read` and `isRead`)
  - Batch notification creation for multiple recipients
  - Persistence verification (read-back after write)
  - Badge count calculation (unread only)
  - Clear read notifications functionality
- **Notification Navigation**: `utils/notificationNavigation.js`
  - Centralized navigation handler for all notification taps
  - Role-aware routing based on notification type and user role
  - Safe navigation with fallbacks (prevents crashes)
  - Nested navigator support (Drawer > MainStack)
  - Automatic read marking after successful navigation
- **Legacy Analytics Utils**: `utils/analytics.js` (to be migrated to `features/analytics/`)
- **Legacy Location Utils**: `utils/location.js` (to be migrated to `features/attendance/utils/`)
- **Legacy Storage**: `utils/storage.js` (use `core/services/storage.js` instead)
- **Legacy Responsive**: `utils/responsive.js` (use `shared/utils/responsive.js` instead)
- **Legacy Screens**: All screens in `screens/` directory including:
  - `ForgotPasswordScreen.js` (password reset request)
  - `ResetPasswordScreen.js` (password reset completion)
  - `ThemeSettingsScreen.js` (includes password change UI)
  - `HelpSupportScreen.js` (Help & Support with production-safe email and fallback modal)
  - Other screens to be migrated to respective feature modules

### Scripts
- **User Creation Script**: `scripts/create-users-supabase.js` - Programmatic user creation via Supabase Admin API
- **Automated User Creation**: `scripts/create-new-users-automated.js` - Automated user creation with validation

---

---

## Supabase Quick Reference

### Configuration Files
- **Frontend**: `core/config/supabase.js` - Exports `supabase`, `supabaseUrl`
- **Backend**: `services/auth-service/config/supabase.js` - Exports `supabase` (with Service Role Key)

### Authentication Service
- **Location**: `apps/mobile/utils/auth.js` (frontend), `services/auth-service/routes/auth.js` (backend)
- **Functions**: `authenticateUser`, `createUser`, `updateUserRole`, `updateUserInfo`, `checkUsernameExists`

### PostgreSQL Tables
- **`users`**: User profiles (`uid` field = Supabase Auth UID)

### Supabase Services
- **Authentication**: Email/password with AsyncStorage persistence via custom adapter
- **PostgreSQL**: SQL database with Supabase client
- **Error Handling**: Comprehensive error codes and messages

### User Management
- **Script**: `scripts/create-users-supabase.js` - Programmatic user creation via Supabase Admin API
- **Automated Script**: `scripts/create-new-users-automated.js` - Automated user creation with validation
- **Source**: Create users directly in Supabase Auth + PostgreSQL

For detailed Supabase setup, see `SETUP.md`.

---

## EAS Build & Deployment

### Overview

The mobile app uses **Expo Application Services (EAS)** for building production APKs and IPAs. EAS handles the build process in the cloud and requires environment variables to be set as secrets.

### Prerequisites

1. **Install EAS CLI:**
   ```bash
   npm install -g eas-cli
   ```

2. **Login to EAS:**
   ```bash
   eas login
   ```

### Setting Up Environment Variables

Environment variables must be set as **EAS secrets** (not `.env` files) for production builds:

```bash
cd apps/mobile

# Set Supabase URL
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://your-project.supabase.co" --scope project

# Set Supabase Anon Key
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your-anon-key-here" --scope project
```

**When prompted:**
- **Visibility**: Select `Sensitive` (hides in logs but accessible for builds)
- **Environment**: Select all three (`development`, `preview`, `production`)

### Building APK

**Preview Build (APK):**
```bash
cd apps/mobile
eas build -p android --profile preview
```

**Production Build (APK):**
```bash
cd apps/mobile
eas build -p android --profile production
```

### Build Profiles

Configured in `apps/mobile/eas.json`:

- **development**: Development client build
- **preview**: APK for internal testing
- **production**: Production APK/AAB

### Troubleshooting APK Crashes

If the APK crashes on installation:

1. **Check Environment Variables:**
   ```bash
   eas env:list
   ```
   Verify both `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set.

2. **Check Crash Logs:**
   ```bash
   adb logcat | grep -i "error\|exception\|crash"
   ```

3. **Verify API Gateway URL:**
   - For physical devices, ensure `app.json` has correct IP address
   - Or deploy backend services to a public URL

### Local Development vs Production

- **Local Development**: Uses `.env` file in `apps/mobile/`
- **EAS Builds**: Uses EAS secrets (set via `eas env:create`)
- **Never commit `.env` files** - they're in `.gitignore`

For detailed EAS build setup, see `apps/mobile/EAS_BUILD_SETUP.md`.

---

## Current Implementation Status

### What's Actually Implemented

**Core Infrastructure (✅ Complete)**
- Supabase configuration and initialization
- Auth and Theme contexts
- Navigation structure (AppNavigator, AuthNavigator, MainNavigator)
- Storage abstraction service

**Shared Code (✅ Complete)**
- Constants (roles, work modes, routes)
- Shared components (Logo, Trademark, CustomDrawer)
- Shared utilities (responsive)

**Features (🔄 Partial Migration)**
- ✅ `features/auth/` - Service and utilities migrated, screens still in `screens/`
- ✅ `features/calendar/` - Component migrated, screen still in `screens/`
- ⏳ All other features - Screens and utils still in legacy directories

**Legacy Code (⚠️ Currently in Use)**
- 18 screens in `screens/` directory
- 17 utility files in `utils/` directory
- 4 components in `components/` directory (some duplicated in `shared/components/`)

**Navigation**
- Currently imports all screens from `screens/` directory
- Uses legacy paths: `import EmployeeDashboard from '../../screens/EmployeeDashboard'`

**App Entry Point**
- `App.js` still imports from `utils/employees` (legacy)
- Uses core contexts and navigation (new structure)

### Migration Progress

- **Phase 1**: ✅ Create new structure (COMPLETED)
- **Phase 2**: 🔄 Migrate features (IN PROGRESS - 2 features partially migrated)
- **Phase 3**: ⏳ Update imports (PENDING)
- **Phase 4**: ⏳ Remove legacy code (PENDING)

### Next Steps for Migration

1. Migrate remaining features to `features/` directory structure
2. Move screens from `screens/` to respective feature modules
3. Move utilities from `utils/` to respective feature modules
4. Create `index.js` files for all feature modules
5. Update navigation to import from feature modules
6. Update `App.js` to use feature modules
7. Remove legacy code after migration is complete

---

---

## CI/CD Pipeline

### GitHub Actions Workflow

**Location:** `.github/workflows/deploy.yml`

**Triggers:**
- Push to `master` or `main` branches
- Pull requests to `master` or `main` branches

**Workflow Steps:**

1. **Checkout Code**
   - Uses `actions/checkout@v3`

2. **Setup Node.js**
   - Uses `actions/setup-node@v4`
   - Node.js version: 18
   - Enables npm caching
   - Cache dependency path: `apps/mobile/package-lock.json`

3. **Verify npm Version**
   - Displays npm version for debugging

4. **Validate package-lock.json**
   - Validates JSON structure
   - Removes corrupted lockfile if invalid
   - Prevents npm ci failures

5. **Install Dependencies**
   - Attempts `npm ci` first (faster, more reliable)
   - Falls back to `npm install` if `npm ci` fails
   - Automatically regenerates lockfile if needed

6. **Run Linter** (Optional)
   - Runs `npm run lint` with graceful failure

7. **Check Code Formatting** (Optional)
   - Runs `npm run format:check` with graceful failure

8. **Build Android**
   - Runs `npm run android:build`
   - Environment: `EXPO_PUBLIC_ENV=production`
   - Graceful failure if build skipped

9. **Build iOS**
   - Runs `npm run ios:build`
   - Environment: `EXPO_PUBLIC_ENV=production`
   - Graceful failure if build skipped

**Key Features:**
- ✅ Package-lock.json validation and auto-recovery
- ✅ Fallback mechanisms for dependency installation
- ✅ Environment variable support
- ✅ Multi-platform build support
- ✅ Graceful error handling

**Troubleshooting:**
- If `npm ci` fails with "Invalid Version" error, workflow automatically regenerates lockfile
- Build steps are optional and won't fail the entire workflow
- All steps include proper error handling

---

*Last Updated: 2026-01-23*

