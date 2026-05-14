# Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [System Architecture](#system-architecture)
4. [Microservices Architecture](#microservices-architecture)
5. [Frontend Architecture](#frontend-architecture)
6. [Backend Services](#backend-services)
7. [Database & Storage](#database--storage)
8. [Authentication & Security](#authentication--security)
9. [API Documentation](#api-documentation)
10. [Development Setup](#development-setup)
11. [Build & Deployment](#build--deployment)
12. [CI/CD Pipeline](#cicd-pipeline)
13. [Testing](#testing)
14. [Performance Optimization](#performance-optimization)
15. [Security Best Practices](#security-best-practices)
16. [Troubleshooting](#troubleshooting)
17. [Code Standards](#code-standards)

---

## Overview

**Hadir.AI** is a comprehensive employee attendance management system built with modern web technologies. The application follows a microservices architecture with a React Native mobile frontend and Node.js backend services.

### Key Technical Highlights

- **Monorepo Structure**: Organized into apps and services
- **Microservices**: API Gateway pattern with service-oriented architecture
- **Cross-Platform**: React Native with Expo for iOS and Android
- **Cloud Backend**: Supabase Authentication and PostgreSQL
- **CI/CD**: Automated builds and deployments via GitHub Actions
- **Modular Architecture**: Feature-based code organization

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React Native | 0.81.5 | Mobile framework |
| React | 19.1.0 | UI library |
| Expo SDK | ~54.0.25 | Development platform |
| React Navigation | 6.x | Navigation library |
| NativeWind | ^2.0.11 | Tailwind CSS for React Native |
| Tailwind CSS | 3.3.2 | Utility-first CSS |

### Backend Services

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime environment |
| Express | ^5.2.1 | Web framework |
| @supabase/supabase-js | ^2.89.0 | Supabase client library |
| Axios | ^1.13.2 | HTTP client |
| CORS | ^2.8.5 | Cross-origin resource sharing |

### Core Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| @supabase/supabase-js | ^2.89.0 | Authentication & PostgreSQL |
| @react-native-async-storage/async-storage | 2.2.0 | Local data persistence |
| expo-location | ~19.0.7 | GPS location tracking |
| expo-local-authentication | ^17.0.7 | Biometric authentication |
| expo-notifications | ~0.32.13 | Push notifications |
| expo-file-system | ~19.0.19 | File operations |
| react-native-gesture-handler | ~2.28.0 | Gesture handling |
| react-native-reanimated | ~4.1.1 | Animations |

### Development Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Runtime |
| npm | Latest | Package manager |
| Expo CLI | Latest | Expo development tools |
| Babel | ^7.20.0 | JavaScript compiler |
| Metro Bundler | Built-in | React Native bundler |

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Application                        │
│                  (React Native + Expo)                       │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Features   │  │    Core      │  │   Shared     │     │
│  │   Modules    │  │ Infrastructure│  │   Code       │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/REST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway                             │
│                    (Port 3000)                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Request Routing & Load Balancing                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Auth Service │   │ Attendance   │   │ Leave Service │
│ (Port 3001)  │   │   Service    │   │  (Future)    │
└──────────────┘   └──────────────┘   └──────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Services                         │
│                    (Cloud Platform)                           │
│                                                               │
│  ┌──────────────┐              ┌──────────────┐            │
│  │ Supabase     │              │  PostgreSQL  │            │
│  │ Authentication│              │   Database   │            │
│  └──────────────┘              └──────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Architecture Principles

1. **Separation of Concerns**: Clear boundaries between frontend, API Gateway, and services
2. **Service Independence**: Each microservice can be developed and deployed independently
3. **API Gateway Pattern**: Single entry point for all client requests
4. **Fail-Safe Design**: Fallback mechanisms for service failures
5. **Scalability**: Horizontal scaling capability for each service

---

## Microservices Architecture

### Service Overview

#### 1. API Gateway Service

**Location:** `services/api-gateway/`

**Purpose:** Single entry point for all client requests

**Technology:**
- Express.js 5.2.1
- Axios 1.13.2
- CORS 2.8.5

**Port:** 3000

**Responsibilities:**
- Route requests to appropriate microservices
- Handle CORS
- Request/response transformation
- Health checks
- Error handling
- Request logging

**Endpoints:**
```
GET  /health                    - Health check
POST /api/auth/login            - Forward to auth-service
GET  /api/auth/check-username/:username - Forward to auth-service
POST /api/auth/users            - Forward to auth-service
PATCH /api/auth/users/:username/role - Forward to auth-service
PATCH /api/auth/users/:username - Forward to auth-service
```

**Configuration:**
```javascript
// Environment variables (optional - defaults provided)
PORT=3000
AUTH_SERVICE_URL=http://localhost:3001
HOST=0.0.0.0  // Listen on all interfaces for device access
```

**API Gateway URL Configuration:**
- **iOS Simulator**: `http://localhost:3000`
- **Android Emulator**: `http://10.0.2.2:3000`
- **Physical Device**: `http://<your-computer-ip>:3000` (configured in `app.json`)

#### 2. Auth Service

**Location:** `services/auth-service/`

**Purpose:** Authentication and user management

**Technology:**
- Express.js 5.2.1
- @supabase/supabase-js 2.89.0
- dotenv 17.2.3

**Port:** 3001

**Responsibilities:**
- User authentication via Supabase Auth
- Password verification
- User creation and management
- Role management
- Username validation
- Database queries to Supabase PostgreSQL

**Endpoints:**
```
GET  /health                    - Health check
POST /api/auth/login            - User authentication
GET  /api/auth/check-username/:username - Username availability
POST /api/auth/users            - Create user
PATCH /api/auth/users/:username/role - Update user role
PATCH /api/auth/users/:username - Update user info
PATCH /api/auth/users/:username/email - Update user email (future use)
```

**Authentication Flow:**
1. Receive username/email + password
2. If username: Query Supabase PostgreSQL to get email
3. Authenticate using Supabase Auth (`signInWithPassword`)
4. Retrieve user data from Supabase PostgreSQL
5. Return user object

**Configuration:**
```javascript
// Environment variables (services/auth-service/.env)
PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

#### 3. Future Services

**Attendance Service** (`services/attendance-service/`)
- Handle attendance tracking
- Manage attendance records
- Calculate attendance statistics

**Leave Service** (`services/leave-service/`)
- Manage leave requests
- Track leave balances
- Process leave approvals

**Ticket Service** (`services/ticket-service/`)
- Handle support tickets
- Route tickets to departments
- Manage ticket lifecycle

---

## Frontend Architecture

### Directory Structure

```
apps/mobile/
├── App.js                      # Main entry point
├── app.json                    # Expo configuration
├── package.json                # Dependencies
├── babel.config.js             # Babel configuration
├── metro.config.js             # Metro bundler config
├── tailwind.config.js          # Tailwind configuration
│
├── core/                       # Core infrastructure
│   ├── config/                 # Configuration
│   │   ├── supabase.js        # Supabase config
│   │   └── api.js             # API Gateway config
│   ├── contexts/               # React Contexts
│   │   ├── AuthContext.js     # Authentication state
│   │   └── ThemeContext.js     # Theme state
│   ├── navigation/             # Navigation setup
│   │   ├── AppNavigator.js    # Main navigator
│   │   ├── AuthNavigator.js  # Auth flow
│   │   └── MainNavigator.js  # Main app flow
│   └── services/               # Core services
│       └── storage.js         # Storage abstraction
│
├── features/                    # Feature modules
│   ├── auth/                   # Authentication
│   │   ├── services/
│   │   ├── utils/
│   │   └── index.js
│   ├── calendar/               # Calendar
│   └── ...                     # Other features
│
├── shared/                     # Shared code
│   ├── components/             # Reusable components
│   ├── constants/              # Constants & enums
│   ├── utils/                 # Shared utilities
│   └── hooks/                  # Shared hooks
│
├── screens/                    # Screen components (legacy)
│   ├── NotificationsScreen.js  # Notification center with state management
│   ├── ForgotPasswordScreen.js  # Password reset request
│   ├── ResetPasswordScreen.js  # Password reset completion
│   ├── ThemeSettingsScreen.js  # Theme settings + password change UI
│   ├── HelpSupportScreen.js    # Help & Support (production-safe email, fallback modal)
│   └── ...
└── utils/                      # Utility functions (legacy)
    ├── notifications.js        # Notification state management
    ├── notificationNavigation.js # Centralized notification navigation handler
    ├── passwordChange.js       # Secure password change utility
    └── calendar.js             # Calendar events (Supabase integration)
```

### Core Components

#### 1. App.js
- Main application entry point
- Wraps app with Context providers
- Initializes navigation

#### 2. Context Providers

**AuthContext:**
- Manages user authentication state
- Provides login/logout functions
- Handles session persistence

**ThemeContext:**
- Manages theme state (light/dark)
- Provides theme toggle functions
- Persists theme preference

#### 3. Navigation Structure

```
AppNavigator
├── AuthNavigator (if not authenticated)
│   ├── LoginScreen
│   ├── SignUpScreen
│   └── AuthMethodSelection
│
└── MainNavigator (if authenticated)
    ├── EmployeeNavigator (for employees)
    │   └── EmployeeDashboard
    │
    └── AdminNavigator (for managers/admins)
        └── AdminDashboard
```

### State Management

- **Context API**: Global state (auth, theme)
- **Local State**: Component-level state (useState)
- **AsyncStorage**: Persistent local storage
- **Supabase**: Cloud state synchronization (Auth + PostgreSQL)

---

## Backend Services

### Service Communication

```
Client → API Gateway → Microservice → Supabase
         (Port 3000)   (Port 3001+)
```

### Request Flow

1. **Client Request**: Mobile app sends HTTP request to API Gateway
2. **Routing**: API Gateway routes to appropriate service
3. **Processing**: Service processes request
4. **Database**: Service queries/updates Supabase PostgreSQL
5. **Response**: Service returns response to API Gateway
6. **Client Response**: API Gateway returns response to client

### Error Handling

**API Gateway:**
- Service unavailable → 503
- Timeout → 504
- Invalid request → 400

**Auth Service:**
- Invalid credentials → 401
- User not found → 404
- Server error → 500

### Health Checks

All services implement health check endpoints:

```javascript
GET /health
Response: { status: "ok", service: "api-gateway", timestamp: "..." }
```

---

## Database & Storage

### Supabase PostgreSQL

**Table Structure:**

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

**Row Level Security (RLS):**
- RLS policies control access at the database level
- Backend uses Service Role Key (bypasses RLS)
- Frontend uses Anon Key (respects RLS policies)
- Calendar events have RLS policies based on visibility settings

**Important Notes:**
- **UID Field**: The `uid` column must match the Supabase Auth User ID (`auth.uid()`)
- If `uid` values don't match, the system falls back to email-based lookup
- Use migration script `supabase/legacy_migrations/011_update_uid_to_match_auth.sql` to update UIDs if needed
- **Calendar Events**: Stored in Supabase (not AsyncStorage), supports visibility settings (`all`, `none`, `selected`)
- Calendar events refresh on screen focus for data consistency

### AsyncStorage (Local)

**Storage Keys:**
- `@company_employees` - Employee list cache (synced from Supabase)
- `@attendance_records` - Attendance data
- `@tickets` - Ticket data
- `@notifications` - Notification data (with read state)
- `@leave_requests` - Leave request data
- `@signup_requests` - Signup request data
- `@auth_preferences` - Authentication preferences
- `@theme_preference` - Theme preference
- `calendar_events` - Calendar events (fallback only, Supabase is primary)

**Data Format:**
- JSON strings stored as values
- Automatic serialization/deserialization
- Persistence verification for critical operations

**Note:** Calendar events are primarily stored in Supabase `calendar_events` table. AsyncStorage is used only as a fallback if Supabase is unavailable.

### Notification System Architecture

**Core Components:**

1. **Notification State Management** (`apps/mobile/utils/notifications.js`)
   - Centralized notification creation and persistence
   - Read state management with dual fields (`read` and `isRead`)
   - Batch notification creation for multiple recipients
   - Persistence verification (read-back after write)
   - Badge count calculation (unread only)

2. **Notification Navigation Handler** (`apps/mobile/utils/notificationNavigation.js`)
   - Centralized navigation handler for all notification taps
   - Role-aware routing based on notification type and user role
   - Safe navigation with fallbacks (prevents crashes)
   - Nested navigator support (Drawer > MainStack)
   - Automatic read marking after successful navigation

3. **Notification Screen** (`apps/mobile/screens/NotificationsScreen.js`)
   - Notification list with filtering (All, Unread, Read)
   - Mark individual/all notifications as read
   - Clear read notifications (preserves unread)
   - Visual distinction for read notifications (reduced opacity)
   - Real-time badge count updates

**Notification State Management:**

**Storage Structure:**
- Notifications stored in `@notifications` key
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

**Read State Management:**
- Default state: All new notifications have `isRead: false`
- Dual fields (`read` and `isRead`) for backward compatibility
- Persistence verification: All write operations verify by reading back
- Badge count calculation: Only counts notifications where `!read && !isRead`

**Notification Operations:**
- `markNotificationAsRead(id)`: Marks single notification as read with verification
- `markAllNotificationsAsRead(username)`: Marks all user notifications as read
- `clearReadNotifications(username)`: Removes only read notifications, preserves unread
- `getUnreadNotificationCount(username)`: Returns count of unread notifications
- `getUserNotifications(username, unreadOnly)`: Retrieves notifications with optional filtering

**Navigation Integration:**
- Centralized navigation handler: `handleNotificationNavigation()`
- Role-aware routing based on notification type and user role
- Automatic read marking after successful navigation
- Safe navigation with fallbacks to prevent crashes
- Nested navigator support (Drawer > MainStack)

---

## Authentication & Security

### Authentication Methods

1. **Username/Email + Password**
   - Primary authentication method
   - Server-side password verification via Supabase Auth
   - Supports both username and email login

2. **Password Change (Self-Service)**
   - Available in Theme Settings screen
   - Requires current password verification via `signInWithPassword`
   - Updates password using `updateUser` API
   - No password data stored locally or in PostgreSQL
   - Self-service only (no admin password resets)
   - Implementation: `utils/passwordChange.js`

3. **Password Reset (Forgot Password Flow)**
   - Users request reset via Forgot Password screen
   - Uses `resetPasswordForEmail` to send reset email
   - Deep linking: `hadirai://reset-password`
   - Supabase handles token generation and validation
   - Email link opens app and navigates to Reset Password screen
   - Users set new password via `updateUser` API
   - Generic success message prevents email enumeration
   - Screens: `ForgotPasswordScreen.js`, `ResetPasswordScreen.js`

4. **Biometric Authentication**
   - **Face ID** (iOS): Native device face recognition, automatically used on iOS devices
   - **Fingerprint** (Android): Fingerprint scanner support, automatically used on Android devices
   - Device-native security with platform-specific implementation
   - Available for login after initial password authentication with "Remember Me"
   - Uses `expo-local-authentication` library
   - Automatic fallback to password if biometric fails
   - Platform detection: iOS uses Face ID/Touch ID, Android uses Fingerprint

### Security Implementation

#### Password Security
- Passwords hashed by Supabase Authentication
- Never stored in plain text
- Server-side verification only
- No password retrieval possible

#### Session Management
- Supabase Auth session tokens
- AsyncStorage persistence via custom adapter
- Automatic session restoration
- Secure token storage

#### API Security
- CORS enabled for cross-origin requests
- Request timeout handling (10 seconds)
- Error message sanitization
- No sensitive data in logs

#### Role-Based Access Control
- Three roles: `employee`, `manager`, `super_admin`
- Permission checks at API level
- Department-based access for managers
- System-wide access for super admins

---

## API Documentation

### API Gateway Endpoints

#### Health Check
```
GET /health
Response: { status: "ok", service: "api-gateway" }
```

#### Authentication Endpoints (Proxied)

All auth endpoints are proxied to auth-service:

```
POST /api/auth/login
Body: { usernameOrEmail: string, password: string }
Response: { success: boolean, user: UserObject }

GET /api/auth/check-username/:username
Response: { available: boolean }

POST /api/auth/users
Body: UserObject
Response: { success: boolean, user: UserObject }

PATCH /api/auth/users/:username/role
Body: { role: string }
Response: { success: boolean }

PATCH /api/auth/users/:username
Body: Partial<UserObject>
Response: { success: boolean, user: UserObject }

PATCH /api/auth/users/:username/email
Body: { email: string }
Response: { success: boolean, user: UserObject }
```

### Supabase Auth API (Client-Side)

#### Password Change
```javascript
// Re-authenticate with current password
const { data, error } = await supabase.auth.signInWithPassword({
  email: userEmail,
  password: currentPassword,
});

// Update password
const { error } = await supabase.auth.updateUser({
  password: newPassword,
});
```

#### Password Reset
```javascript
// Request password reset email
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: 'hadirai://reset-password',
});

// Set new password (after clicking email link)
const { error } = await supabase.auth.updateUser({
  password: newPassword,
});
```

### Auth Service Endpoints

#### Login
```
POST /api/auth/login
Content-Type: application/json

Request:
{
  "usernameOrEmail": "testuser",
  "password": "password123"
}

Response (Success):
{
  "success": true,
  "user": {
    "uid": "supabase_auth_uid",
    "username": "testuser",
    "email": "testuser@company.com",
    "name": "Test User",
    "role": "employee",
    "department": "Engineering",
    ...
  }
}

Response (Error):
{
  "success": false,
  "error": "Invalid username or password"
}
```

#### Check Username
```
GET /api/auth/check-username/:username

Response:
{
  "available": true
}
```

#### Create User
```
POST /api/auth/users
Content-Type: application/json

Request:
{
  "username": "newuser",
  "email": "newuser@company.com",
  "password": "password123",
  "name": "New User",
  "role": "employee",
  "department": "Engineering",
  ...
}

Response:
{
  "success": true,
  "user": { ... }
}
```

---

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (for iOS) or Android Emulator (for Android)
- Supabase project with Authentication and PostgreSQL enabled
- EAS CLI (for production builds): `npm install -g eas-cli`

### Installation Steps

1. **Clone Repository**
   ```bash
   git clone <repository-url>
   cd AttendanceApp
   ```

2. **Install Mobile App Dependencies**
   ```bash
   cd apps/mobile
   npm install
   ```

3. **Install API Gateway Dependencies**
   ```bash
   cd services/api-gateway
   npm install
   ```

4. **Install Auth Service Dependencies**
   ```bash
   cd services/auth-service
   npm install
   ```

5. **Configure Supabase**
   - Create Supabase project at https://supabase.com
   - Create `users` table (see database schema above)
   - Get Supabase URL and API keys from project settings
   - Copy Supabase config to `apps/mobile/core/config/supabase.js`
   - Set up Row Level Security (RLS) policies

6. **Configure Environment Variables**

   **API Gateway** (`services/api-gateway/.env` - optional):
   ```env
   PORT=3000
   AUTH_SERVICE_URL=http://localhost:3001
   HOST=0.0.0.0
   ```

   **Auth Service** (`services/auth-service/.env`):
   ```env
   PORT=3001
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

   **Mobile App** (`apps/mobile/.env`):
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

   **Mobile App** (`apps/mobile/app.json`):
   ```json
   {
     "expo": {
       "scheme": "hadirai",
       "extra": {
         "apiGatewayUrl": "http://192.168.18.38:3000",
         "supabaseRedirectUrl": "hadirai://reset-password"
       }
     }
   }
   ```
   *Update with your computer's IP address for physical device testing*
   *Deep linking scheme `hadirai` is required for password reset flow*

7. **Start Services**

   **Option 1: Using Scripts**
   ```bash
   # Windows
   .\start-services.ps1
   
   # Linux/macOS
   ./start-services.sh
   ```

   **Option 2: Manual**
   ```bash
   # Terminal 1: API Gateway
   cd services/api-gateway
   npm start
   
   # Terminal 2: Auth Service
   cd services/auth-service
   npm start
   
   # Terminal 3: Mobile App
   cd apps/mobile
   npm start
   ```

### Development Workflow

1. Start backend services (API Gateway + Auth Service)
2. Start Expo development server
3. Open app in simulator/emulator or physical device
4. Make code changes (hot reload enabled)
5. Test features

---

## Build & Deployment

### Mobile App Build

#### EAS Build (Recommended for Production)

**Prerequisites:**
1. Install EAS CLI: `npm install -g eas-cli`
2. Login: `eas login`
3. Set environment variables as secrets:
   ```bash
   cd apps/mobile
   eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://your-project.supabase.co" --scope project
   eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your-anon-key" --scope project
   ```

**Build Commands:**
```bash
cd apps/mobile

# Preview build (APK)
eas build -p android --profile preview

# Production build (APK/AAB)
eas build -p android --profile production

# iOS build
eas build -p ios --profile production
```

**Build Profiles:**
- `development`: Development client
- `preview`: Internal testing APK
- `production`: Production APK/AAB

For detailed setup, see `apps/mobile/EAS_BUILD_SETUP.md`.

#### Local Build (Alternative)

**Android Build:**
```bash
cd apps/mobile
npm run android:build
```

**iOS Build:**
```bash
cd apps/mobile
npm run ios:build
```

### Backend Service Deployment

#### API Gateway
```bash
cd services/api-gateway
npm start
# Or use PM2 for production
pm2 start index.js --name api-gateway
```

#### Auth Service
```bash
cd services/auth-service
npm start
# Or use PM2 for production
pm2 start index.js --name auth-service
```

### Production Considerations

1. **Environment Variables**: 
   - Use EAS secrets for mobile app builds (`eas env:create`)
   - Use secure `.env` files for backend services (never commit)
   - Never expose Service Role Key in client code
2. **Service Role Key**: Secure Supabase service role key (backend only)
3. **HTTPS**: Use HTTPS for all API endpoints
4. **Monitoring**: Set up logging and monitoring
5. **Scaling**: Use load balancers for multiple instances
6. **Database**: Configure PostgreSQL indexes for production queries
7. **Row Level Security**: Enable RLS policies in Supabase for data protection

---

## CI/CD Pipeline

### GitHub Actions Workflow

**File:** `.github/workflows/deploy.yml`

**Triggers:**
- Push to `master` or `main`
- Pull requests to `master` or `main`

**Workflow Steps:**

1. **Checkout Code**
   - Uses `actions/checkout@v3`

2. **Setup Node.js**
   - Uses `actions/setup-node@v4`
   - Node.js 18
   - npm caching enabled

3. **Verify npm Version**
   - Displays npm version for debugging

4. **Validate package-lock.json**
   - Validates JSON structure
   - Removes corrupted lockfile if invalid

5. **Install Dependencies**
   - Attempts `npm ci`
   - Falls back to `npm install` if needed
   - Auto-regenerates lockfile if corrupted

6. **Run Linter** (Optional)
   - `npm run lint`

7. **Check Formatting** (Optional)
   - `npm run format:check`

8. **Build Android**
   - `npm run android:build`
   - Environment: `EXPO_PUBLIC_ENV=production`

9. **Build iOS**
   - `npm run ios:build`
   - Environment: `EXPO_PUBLIC_ENV=production`

### Workflow Features

- ✅ Automatic dependency validation
- ✅ Package-lock.json corruption recovery
- ✅ Multi-platform builds
- ✅ Environment variable support
- ✅ Graceful error handling

---

## Testing

### Testing Strategy

#### Unit Tests
- Test individual functions and utilities
- Mock external dependencies
- Test edge cases

#### Integration Tests
- Test API endpoints
- Test service communication
- Test Supabase integration

#### E2E Tests
- Test complete user flows
- Test authentication flows
- Test role-based access

### Test Setup

```bash
# Install testing dependencies
npm install --save-dev jest @testing-library/react-native

# Run tests
npm test
```

---

## Performance Optimization

### Frontend Optimizations

1. **Code Splitting**: Lazy load screens and components
2. **Image Optimization**: Optimize images and use appropriate formats
3. **Memoization**: Use React.memo and useMemo for expensive operations
4. **List Optimization**: Use FlatList with proper keyExtractor
5. **AsyncStorage**: Batch operations and cache frequently accessed data

### Backend Optimizations

1. **Connection Pooling**: Reuse database connections
2. **Caching**: Cache frequently accessed data
3. **Request Batching**: Batch multiple operations
4. **Indexing**: Proper Firestore indexes for queries

### Network Optimizations

1. **Request Timeout**: 10-second timeout for API requests
2. **Retry Logic**: Automatic retry for failed requests
3. **Offline Support**: Local caching for offline access
4. **Compression**: Enable gzip compression

---

## Security Best Practices

### Code Security

1. **No Hardcoded Secrets**: Use environment variables
2. **Input Validation**: Validate all user inputs
3. **SQL Injection Prevention**: Use parameterized queries (Firestore handles this)
4. **XSS Prevention**: Sanitize user inputs
5. **CSRF Protection**: Use tokens for state-changing operations

### API Security

1. **Authentication**: All protected endpoints require authentication
2. **Authorization**: Role-based access control
3. **Rate Limiting**: Implement rate limiting for API endpoints
4. **HTTPS Only**: Use HTTPS in production
5. **CORS Configuration**: Proper CORS settings

### Data Security

1. **Password Hashing**: Supabase handles password hashing
2. **Encryption**: Encrypt sensitive data at rest
3. **Secure Storage**: Use secure storage for tokens
4. **Data Validation**: Validate data before storage

---

## Troubleshooting

### Common Issues

#### 1. npm ci "Invalid Version" Error

**Symptoms:** npm ci fails with "Invalid Version" error

**Solution:**
- Workflow automatically handles this
- Manually: Delete `package-lock.json` and run `npm install`

#### 2. Supabase Connection Issues

**Symptoms:** Cannot connect to Supabase

**Solution:**
- Check Supabase configuration
- Verify API keys (URL and keys)
- Check network connectivity
- Verify RLS policies are set correctly
- Ensure Supabase project is active

#### 3. API Gateway Connection Failed

**Symptoms:** Frontend cannot connect to API Gateway

**Solution:**
- Verify API Gateway is running (port 3000)
- Check API Gateway URL in config
- Verify CORS settings
- Check network connectivity

#### 4. Authentication Failures

**Symptoms:** Login fails with various errors

**Solution:**
- Check Supabase Authentication is enabled
- Verify user exists in Supabase Auth
- Check PostgreSQL `users` table has matching record
- Verify password is correct
- Check Supabase service role key is correct
- Verify `uid` in database matches Supabase Auth UID

#### 5. Metro Bundler Issues

**Symptoms:** App won't start or bundle errors

**Solution:**
- Clear Metro cache: `npx expo start -c`
- Delete node_modules and reinstall
- Check metro.config.js configuration

---

## Code Standards

### Naming Conventions

- **Files**: PascalCase for components, camelCase for utilities
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Components**: PascalCase
- **Functions**: camelCase

### Code Organization

- **Features**: Self-contained feature modules
- **Shared Code**: Reusable components and utilities
- **Core**: Infrastructure and configuration
- **Services**: Backend microservices

### Best Practices

1. **Modularity**: Keep features isolated
2. **Reusability**: Create reusable components
3. **Error Handling**: Comprehensive error handling
4. **Documentation**: Comment complex logic
5. **Type Safety**: Use consistent data structures

---

## Additional Resources

### Documentation
- [Modular Architecture Guide](MODULAR_ARCHITECTURE.md)
- [System Architecture](SYSTEM_ARCHITECTURE.md)
- [App Features](APP_FEATURES.md)
- [Structure Summary](STRUCTURE_SUMMARY.md)

### External Resources
- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [Supabase Documentation](https://supabase.com/docs)
- [Express.js Documentation](https://expressjs.com/)

---

*Last Updated: 2026-01-23*

