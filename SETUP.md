# Setup Guide - Attendance App with Supabase

Complete setup instructions for running the Attendance App with Supabase backend.

---

## 📋 Prerequisites

### Required Software

1. **Node.js** (v18 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify: `node --version`

2. **npm** (comes with Node.js)
   - Verify: `npm --version`

3. **Git** (for cloning the repository)
   - Download from [git-scm.com](https://git-scm.com/)

4. **Expo CLI** (for mobile app development)
   ```bash
   npm install -g expo-cli
   ```

5. **PowerShell** (Windows) or **Bash** (Linux/macOS)
   - Windows: PowerShell 5.1+ (included with Windows)
   - Linux/macOS: Bash (usually pre-installed)

### Optional (for mobile development)

- **Expo Go** app on your mobile device
- **iOS Simulator** (Mac only) - via Xcode
- **Android Emulator** - via Android Studio

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/ABDULLAHUMAR020703/AttendanceApp-SupaBase.git
cd AttendanceApp-SupaBase
```

### 2. Install Dependencies

#### Root Dependencies
```bash
npm install
```

#### Backend Services
The start script will install these automatically, or install manually:

```bash
# API Gateway
cd services/api-gateway
npm install
cd ../..

# Auth Service
cd services/auth-service
npm install
cd ../..
```

#### Mobile App
```bash
cd apps/mobile
npm install
cd ../..
```

**Note:** The start script (`start-services.ps1` or `start-services.sh`) will automatically check and install dependencies if needed.

### 3. Configure Environment Variables

The project includes `.env.example` files as templates. Copy these to create your `.env` files.

#### Step 1: Backend - Auth Service

1. **Copy the example file:**
   ```bash
   cd services/auth-service
   copy .env.example .env    # Windows
   # OR
   cp .env.example .env      # Linux/macOS
   ```

2. **Edit `.env` and fill in your Supabase credentials:**
   ```env
   # Server Configuration
   PORT=3001
   HOST=0.0.0.0

   # Supabase Configuration
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   ```

3. **How to get Supabase credentials:**
   - Go to [Supabase Dashboard](https://app.supabase.com/)
   - Select your project
   - Go to **Settings** → **API**
   - Copy:
     - **Project URL** → `SUPABASE_URL`
     - **service_role key** (secret, NOT anon key) → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ **Important:** Use the `service_role` key, NOT the `anon` key!

#### Step 2: Backend - API Gateway (Optional)

The API Gateway has default values, but you can customize:

```bash
cd services/api-gateway
copy .env.example .env    # Windows
# OR
cp .env.example .env      # Linux/macOS
```

Edit `.env` if you need to change ports or Auth Service URL (defaults work for most cases).

#### Step 3: Frontend - Mobile App

1. **Copy the example file:**
   ```bash
   cd apps/mobile
   copy .env.example .env    # Windows
   # OR
   cp .env.example .env      # Linux/macOS
   ```

2. **Edit `.env` and fill in your Supabase credentials:**
   ```env
   # Supabase Configuration
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. **How to get Supabase credentials:**
   - Go to [Supabase Dashboard](https://app.supabase.com/)
   - Select your project
   - Go to **Settings** → **API**
   - Copy:
     - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
     - **anon public key** (NOT service_role) → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - ⚠️ **Important:** Use the `anon` key for frontend, NOT the `service_role` key!

4. **Important Notes:**
   - ✅ The `EXPO_PUBLIC_` prefix is **required** for Expo to expose these variables
   - ✅ These keys are safe to expose in client code (they're public keys)
   - ❌ Never use the `service_role` key in the frontend - that's for backend only!
   - 🔄 **Restart Expo server** after creating/updating `.env` file

#### Step 4: Configure API Gateway URL for Physical Devices

If testing on a physical device, update `apps/mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "apiGatewayUrl": "http://192.168.18.38:3000"
    }
  }
}
```

Replace `192.168.18.38` with your computer's IP address:
- **Windows:** Run `ipconfig` and look for "IPv4 Address" under your active network adapter
- **Mac/Linux:** Run `ifconfig` or `ip addr` and look for your local IP

**Note:** For simulators/emulators, this is not needed (defaults work).

### 4. Set Up Supabase Database

#### Option A: Use Existing Database (If Already Set Up)

If the database is already configured, skip to step 5.

#### Option B: Create Database Schema

1. Go to Supabase Dashboard → **SQL Editor**
2. Apply schema from the SQL files under `supabase/legacy_migrations/` in dependency order (see `supabase/README.md`), or use `npm run db:push` after linking the project for CLI-managed migrations under `supabase/migrations/`.
3. Or use the Node.js script to create users:

```bash
node scripts/create-users-supabase.js
```

This will create:
- All 11 demo users in Supabase Auth
- All user profiles in the database

**Login Credentials:**
- Super Admin: `testadmin` / `testadmin123`
- Manager: `techmanager` / `techmanager123`
- Employee: `testuser` / `testuser123`

See `MANUAL_USER_CREATION_GUIDE.md` for all credentials.

---

## 🏃 Running the Project

### Method 1: Using Start Script (Recommended)

#### Windows (PowerShell)
```powershell
.\start-services.ps1
```

This will:
- ✅ Check ports 3000 and 3001
- ✅ Install dependencies if needed
- ✅ Start API Gateway (port 3000)
- ✅ Start Auth Service (port 3001)
- ✅ Open separate terminal windows for each service

#### Linux/macOS (Bash)
```bash
./start-services.sh
```

### Method 2: Manual Start

#### Terminal 1: API Gateway
```bash
cd services/api-gateway
npm start
```

#### Terminal 2: Auth Service
```bash
cd services/auth-service
npm start
```

#### Terminal 3: Mobile App
```bash
cd apps/mobile
npm start
```

---

## 📱 Running the Mobile App

### Start Expo Development Server

```bash
cd apps/mobile
npm start
```

### Open on Device/Simulator

**iOS Simulator (Mac only):**
- Press `i` in the terminal
- Or scan QR code with Expo Go app

**Android Emulator:**
- Press `a` in the terminal
- Or scan QR code with Expo Go app

**Physical Device:**
- Install **Expo Go** app from App Store/Play Store
- Scan the QR code shown in terminal
- Make sure device and computer are on the same WiFi network

**Web Browser:**
- Press `w` in the terminal

---

## 🔍 Verifying Setup

### 1. Check Backend Services

**API Gateway:**
```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok","message":"API Gateway is running",...}`

**Auth Service:**
```bash
curl http://localhost:3001/health
```
Expected: `{"status":"ok","message":"Auth Service is running",...}`

### 2. Test Login Endpoint

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usernameOrEmail":"testadmin","password":"testadmin123"}'
```

Expected: `{"success":true,"user":{...}}`

### 3. Check Mobile App Connection

1. Open the app in simulator/emulator
2. Try logging in with:
   - Username: `testadmin`
   - Password: `testadmin123`

---

## 🏗️ Project Structure

```
AttendanceApp-SupaBase/
├── apps/
│   └── mobile/              # React Native/Expo mobile app
│       ├── core/
│       │   ├── config/
│       │   │   └── supabase.js    # Supabase client config
│       │   └── contexts/
│       │       └── AuthContext.js # Auth state management
│       ├── features/
│       │   └── auth/
│       │       └── services/
│       │           └── authService.js
│       ├── utils/
│       │   └── auth.js            # Auth utilities
│       └── .env                   # Mobile app env vars
│
├── services/
│   ├── api-gateway/          # API Gateway service
│   │   └── index.js
│   │
│   └── auth-service/         # Authentication service
│       ├── config/
│       │   └── supabase.js   # Supabase backend config
│       ├── routes/
│       │   └── auth.js       # Auth endpoints
│       ├── index.js
│       └── .env              # Backend env vars
│
├── scripts/
│   └── create-users-supabase.js  # User creation script
│
├── supabase/
│   ├── migrations/               # CLI-managed (db push)
│   ├── legacy_migrations/      # Historical SQL
│   └── config.toml
│
└── start-services.ps1        # Start script (Windows)
```

---

## 🔧 Configuration Details

### API Gateway

**Port:** 3000  
**Purpose:** Routes requests from mobile app to backend services

**Configuration:** `services/api-gateway/index.js`
- No environment variables needed
- Automatically forwards `/api/auth/*` to Auth Service

### Auth Service

**Port:** 3001  
**Purpose:** Handles authentication and user management

**Configuration:** `services/auth-service/.env`
```env
PORT=3001
HOST=0.0.0.0
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Endpoints:**
- `POST /api/auth/login` - User login
- `GET /api/auth/check-username/:username` - Check username availability
- `POST /api/auth/users` - Create new user
- `PATCH /api/auth/users/:username/role` - Update user role
- `PATCH /api/auth/users/:username` - Update user info

### Mobile App

**Configuration:** `apps/mobile/.env`
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**API Gateway URL:** Automatically configured based on platform:
- iOS Simulator: `http://localhost:3000`
- Android Emulator: `http://10.0.2.2:3000`
- Physical Device: `http://<your-computer-ip>:3000`

---

## 🐛 Troubleshooting

### Backend Services Won't Start

**Problem:** Port already in use
```bash
# Check what's using the port
netstat -ano | findstr :3000  # Windows
lsof -i :3000                 # Linux/macOS

# Kill the process or change port in .env
```

**Problem:** Dependencies not installed
```bash
cd services/auth-service
npm install
```

**Problem:** Missing environment variables
- Check that `.env` files exist
- Verify all required variables are set
- Restart the service after adding variables

### Mobile App Can't Connect

**Problem:** "Network request failed"
- ✅ Check backend services are running
- ✅ Verify API Gateway URL is correct for your platform
- ✅ For physical device: Ensure device and computer are on same WiFi
- ✅ Check firewall isn't blocking ports 3000/3001

**Problem:** "Cannot connect to Supabase"
- ✅ Check `EXPO_PUBLIC_SUPABASE_URL` is set correctly
- ✅ Verify `EXPO_PUBLIC_SUPABASE_ANON_KEY` is set
- ✅ Restart Expo server after changing .env

**Problem:** Login fails
- ✅ Check backend services are running
- ✅ Verify Supabase credentials in `services/auth-service/.env`
- ✅ Check user exists in Supabase (use Supabase Dashboard)

### Supabase Connection Issues

**Problem:** "Missing Supabase environment variables"
- ✅ Create `.env` files in correct locations
- ✅ Use correct variable names:
  - Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - Frontend: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

**Problem:** "Authentication failed"
- ✅ Verify credentials are correct
- ✅ Check Supabase project is active
- ✅ Ensure users exist in Supabase Auth

---

## 📝 Environment Variables Reference

### Using .env.example Files

The project includes `.env.example` files in each service directory. These are templates with:
- ✅ All required variables listed
- ✅ Helpful comments explaining each variable
- ✅ Instructions on where to get values
- ✅ Security warnings where applicable

**To set up:**
1. Copy `.env.example` to `.env` in the same directory
2. Fill in your actual values
3. Never commit `.env` files to git (they're in `.gitignore`)

### Backend (`services/auth-service/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `HOST` | No | Server host (default: 0.0.0.0) |
| `SUPABASE_URL` | **Yes** | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase service role key (secret) |

**Template:** `services/auth-service/.env.example`

### Backend (`services/api-gateway/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `HOST` | No | Server host (default: 0.0.0.0) |
| `AUTH_SERVICE_URL` | No | Auth Service URL (default: http://localhost:3001) |

**Template:** `services/api-gateway/.env.example`  
**Note:** Optional - defaults work for most cases

### Frontend (`apps/mobile/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | **Yes** | Your Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Supabase anonymous/public key |

**Template:** `apps/mobile/.env.example`

**Important Notes:**
- ✅ Frontend variables must start with `EXPO_PUBLIC_` to be accessible in Expo
- ✅ Use `anon` key for frontend (public, safe for client)
- ❌ Never use `service_role` key in frontend (backend only!)
- 🔄 Restart Expo server after creating/updating `.env`

---

## 🎯 Next Steps

After setup is complete:

1. ✅ **Test Login**
   - Use credentials from `MANUAL_USER_CREATION_GUIDE.md`
   - Try: `testadmin` / `testadmin123`

2. ✅ **Explore Features**
   - Check attendance tracking
   - Test leave management
   - Try ticket system

3. ✅ **Development**
   - Make code changes
   - Hot reload is enabled
   - Check logs in service terminals

---

## 📚 Additional Resources

- **Supabase Dashboard:** [app.supabase.com](https://app.supabase.com/)
- **Supabase Docs:** [supabase.com/docs](https://supabase.com/docs)
- **Expo Docs:** [docs.expo.dev](https://docs.expo.dev/)
- **React Native Docs:** [reactnative.dev](https://reactnative.dev/)

---

## ✅ Setup Checklist

- [ ] Node.js installed (v18+)
- [ ] Repository cloned
- [ ] Dependencies installed (root, services, mobile app)
- [ ] Supabase project created
- [ ] Backend `.env` created from `.env.example` (`services/auth-service/.env`)
- [ ] Frontend `.env` created from `.env.example` (`apps/mobile/.env`)
- [ ] Supabase credentials added to `.env` files
- [ ] API Gateway URL configured in `app.json` (if using physical device)
- [ ] Database schema created (or users created via script)
- [ ] Backend services started (API Gateway + Auth Service)
- [ ] Mobile app started (Expo)
- [ ] Login tested successfully

---

**Setup complete!** 🎉 You're ready to develop and test the Attendance App with Supabase!

