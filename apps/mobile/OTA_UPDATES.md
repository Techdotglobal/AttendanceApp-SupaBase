# OTA Updates — Hadir.AI

EAS Update lets you push JavaScript, TypeScript, and asset changes to live users
instantly — no App Store or Play Store submission required.

---

## How OTA Updates Work

```
You push code
     │
     ▼
GitHub Actions runs eas update --branch production
     │
     ▼
EAS servers bundle & publish the new JS
     │
     ▼
On next app launch, expo-updates detects the new bundle (ON_LOAD)
     │
     ▼
Bundle downloads silently in background
     │
     ▼
User sees "Update Ready" prompt → taps "Restart Now"
(or it applies automatically on next cold start)
```

### Runtime Version

`runtimeVersion: { policy: "sdkVersion" }` — the runtime version equals the
Expo SDK version string (e.g. `"54.0.0"`). An OTA update published for SDK 54
is **only delivered to SDK 54 builds**. Upgrading the SDK requires a new store
build before OTA resumes.

### Branch → Channel Mapping

| Git Branch   | EAS Channel  | Audience                              |
|-------------|--------------|---------------------------------------|
| `master`    | `preview`    | Internal testers (TestFlight / APK)  |
| `production`| `production` | Live App Store + Play Store users    |
| `development`| `development`| Local dev client                     |

---

## When OTA is Sufficient (JS-only changes)

✅ Bug fixes in `.js` / `.ts` / `.tsx` files  
✅ UI changes, new screens, component updates  
✅ Business logic, API calls, Supabase queries  
✅ Localization / copy / color changes  
✅ Asset swaps (images, fonts already in the bundle)  
✅ Navigation changes  
✅ Context, hooks, utility functions  

---

## When a Full Store Build Is Required

⛔ Adding a new native package (`npm install react-native-xyz`)  
⛔ Changing `app.json` plugins that generate native code  
⛔ Upgrading the Expo SDK version  
⛔ Modifying `android/` or `ios/` native code directly  
⛔ Changing app permissions, entitlements, or capabilities  
⛔ Updating splash screen or app icon  
⛔ Changing the app bundle identifier or package name  
⛔ Adding push notification certificates  

---

## Deploying OTA Updates Manually

### Prerequisites

```bash
# Install EAS CLI globally (once)
npm install -g eas-cli

# Log in to your Expo account
eas login
```

### Deploy to production

```bash
cd apps/mobile
eas update --branch production --message "fix: leave request company_id"
```

### Deploy to preview (for QA before production)

```bash
cd apps/mobile
eas update --branch preview --message "test: signup request RLS fix"
```

### Deploy to a specific platform only

```bash
# iOS only
eas update --branch production --platform ios --message "fix: iOS-only issue"

# Android only
eas update --branch production --platform android --message "fix: Android-only issue"
```

---

## GitHub Actions Automation

The workflow at `.github/workflows/eas-update.yml` auto-deploys on push.

### Setup (one-time)

1. Go to **expo.dev → Account Settings → Access Tokens**
2. Create a new token named `GITHUB_ACTIONS`
3. In GitHub: **Repository → Settings → Secrets → Actions**
4. Add secret: `EXPO_TOKEN` = `<the token from step 2>`

### How it triggers

| Event                         | Result                          |
|-------------------------------|---------------------------------|
| Push to `master`              | OTA → `preview` channel         |
| Push to `production` branch   | OTA → `production` channel      |
| Manual workflow dispatch      | OTA → channel you choose        |

### Path filtering

The workflow only runs when files inside `apps/mobile/` change — and
**ignores** `android/`, `ios/`, and `node_modules/` to prevent false triggers.

### Manual trigger from GitHub UI

1. Go to **Actions → EAS OTA Update → Run workflow**
2. Select channel (`preview` or `production`)
3. Enter an optional message
4. Click **Run workflow**

---

## Rollback Strategy

### Option A — Roll back via EAS CLI (recommended)

```bash
# List recent updates for the production branch
eas update:list --branch production

# Roll back by re-publishing a previous update group
eas update:roll-back-to-embedded --branch production
# OR republish a known-good group ID:
eas update --branch production --group <previous-group-id>
```

### Option B — Roll back via EAS Dashboard

1. Go to **expo.dev → Projects → attendance-app → Updates**
2. Find the last working update
3. Click **Re-publish** on that update group

### Option C — Emergency: point channel to embedded bundle

```bash
# Forces all users back to the bundle embedded in the store build
eas channel:edit production --head ""
```

This is the nuclear option — use only if a bad OTA update is causing crashes.

---

## Safe Deployment Practices

1. **Always deploy to `preview` first.** Test on TestFlight / internal APK before
   merging to `production`.
2. **Use descriptive messages.** `eas update --message "fix: leave request RLS"`
   makes rollbacks easier to identify.
3. **Never OTA-update native code.** If you add a native package, do a full
   EAS build first, submit to stores, then resume OTA.
4. **Increment `version` in `app.json` for major releases** even if done via OTA,
   so version numbers stay meaningful in crash reports.
5. **Monitor after deploy.** Check Sentry / console logs in the first 30 minutes
   after a production OTA push.

---

## Full Commands Reference

### Production store build + submit

```bash
cd apps/mobile

# Build for both platforms
eas build --platform all --profile production

# Submit iOS to App Store Connect
eas submit --platform ios --profile production

# Submit Android to Play Store
eas submit --platform android --profile production
```

### Preview / internal APK build

```bash
eas build --platform android --profile preview
# Download the APK from the EAS dashboard or share link
```

### Development build (local dev client)

```bash
eas build --platform android --profile development
# Install on device, then run: npx expo start --dev-client
```

### OTA update — production

```bash
eas update --branch production --message "your message here"
```

### OTA update — preview

```bash
eas update --branch preview --message "your message here"
```

### Check which update a build is running

```bash
eas update:list --branch production
```

### Inspect update channels

```bash
eas channel:list
```

---

## Important: First Store Build Required

> **The existing App Store and Play Store installs do NOT have OTA configured.**
> 
> The current store builds were compiled before `runtimeVersion` and `updates.url`
> were added to `app.json`. OTA updates will only reach users **after** they
> install a new store build that was compiled with this configuration.
>
> **Action required:**
> 1. Run `eas build --platform all --profile production`
> 2. Submit both platforms to their stores
> 3. Once users update to that new version, all future JS changes can be
>    deployed as OTA — no more store submissions for bug fixes.

---

## Verifying OTA Is Working

After deploying an OTA update, you can verify it landed:

```bash
# Check the update was published
eas update:list --branch production

# On a test device: cold-start the app and check logs
# You should see the "Update Ready" alert if a new bundle was fetched
```

In the EAS dashboard (**expo.dev → Projects → attendance-app → Updates**) you can
see each update group, the platforms it targets, its runtime version, and how
many devices have downloaded it.
