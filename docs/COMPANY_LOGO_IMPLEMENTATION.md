# Company Logo Customization – Implementation Summary

This document summarizes the company logo feature. **Run the SQL scripts manually in Supabase** (Cursor cannot modify your Supabase project).

---

## Upload strategy (versioned filenames)

- **Do not use `upsert: true`.** Each upload creates a **new** file.
- **Do not reuse the same filename.** Filenames are versioned: `company-{companyId}-{timestamp}.{ext}` (e.g. `company-uuid-1709573829.png`).
- This avoids CDN caching issues: the app always uses the latest URL stored in `companies.logo_url`.
- **Old files:** Previous uploads remain in the bucket (optional cleanup later). Do not rename or overwrite files in Supabase; each upload is a new object.

---

## 1. SQL migration (run first)

**File:** `migrations/020_create_companies_table.sql`

Run the entire script in **Supabase Dashboard → SQL Editor**.

It:

- Creates `companies` table (`id`, `name`, `logo_url`, `created_at`, `updated_at`)
- Inserts one row: `name = 'Default Company'` (only if the table is empty)
- Adds `updated_at` trigger
- Enables RLS
- Adds policies: authenticated users can `SELECT`; only `super_admin` can `UPDATE` (using `users.uid` and `users.role`)

---

## 2. Storage bucket + policies

### 2.1 Create bucket in Supabase Dashboard

1. Open your project → **Storage**.
2. **New bucket**.
3. **Name:** `company-logos`
4. **Public bucket:** **Yes**
5. Create bucket.

### 2.2 Storage policies (SQL)

**File:** `migrations/021_company_logos_storage_policies.sql`

Run in **Supabase SQL Editor** after the bucket exists.

It adds policies on `storage.objects` for bucket `company-logos`:

- **SELECT:** public (so the app can show the logo via public URL)
- **INSERT / UPDATE / DELETE:** only `super_admin` (via `public.users` and `auth.uid()`)

Details: `docs/STORAGE_SETUP.md`

**Bucket verification (production):**

- Bucket **name** must be exactly `company-logos`.
- Bucket must be **public** (Dashboard → Storage → bucket → Public bucket: Yes).
- Policy `"Public read access for company logos"` on `storage.objects` must allow `SELECT` for `bucket_id = 'company-logos'` so the app can render the image from the public URL. If the logo does not render, run `migrations/021_company_logos_storage_policies.sql` and ensure no other RLS blocks public read for this bucket.

---

## 3. Frontend (already implemented)

### 3.1 Feature module

- **`features/company/services/companyService.js`**  
  `getCompany()`, `uploadLogo(companyId, file)`, `updateCompanyLogo(companyId, file)`  
  Uses `core/config/supabase.js`. Upload path: `company-logos/company-{companyId}-{timestamp}.{ext}` (versioned; no upsert).

- **`features/company/screens/CompanySettingsScreen.js`**  
  Super_admin only. Uses `expo-image-picker` (gallery), uploads to storage, updates `companies.logo_url`, loading/success/error states.

- **`features/company/index.js`**  
  Exports service and screen.

### 3.2 Core

- **`core/contexts/CompanyContext.js`**  
  Fetches company when user is set, caches `company` and `logoUrl`, exposes `refreshCompany()`.

- **`shared/components/Logo.js`**  
  Uses `CompanyContext`. If `logoUrl` exists and load succeeds → show remote image; else → default `assets/logo.png`. Loading fallback and `onError` fallback to default.

### 3.3 App wiring

- **`App.js`**  
  Wraps app with `CompanyProvider` (inside `AuthProvider`).

- **`shared/constants/routes.js`**  
  Added `COMPANY_SETTINGS: 'CompanySettings'` and to `SUPER_ADMIN_ROUTES`.

- **`core/navigation/MainNavigator.js`**  
  Registered `CompanySettingsScreen` for `super_admin` only.

- **`shared/components/CustomDrawer.js`**  
  Added “Company Logo” menu item for `super_admin`, linking to `ROUTES.COMPANY_SETTINGS`.

### 3.4 Dependency

- **`expo-image-picker`**  
  Installed in `apps/mobile` for gallery image selection.

---

## 4. Order of operations

1. Run **`migrations/020_create_companies_table.sql`** in Supabase SQL Editor.
2. Create bucket **`company-logos`** (public) in Storage.
3. Run **`migrations/021_company_logos_storage_policies.sql`** in SQL Editor.
4. Use the app: log in as **super_admin** → drawer → **Company Logo** → pick image → upload. Logo appears everywhere `<Logo />` is used.

---

## 5. Optional: change default company name

After migration, you can update the default company name in Supabase:

```sql
UPDATE companies SET name = 'Your Company Name' WHERE id = (SELECT id FROM companies LIMIT 1);
```

(Or use the first company row by another condition if you add more later.)

---

## 6. How to test properly

1. **Supabase**
   - Run `020_create_companies_table.sql` and `021_company_logos_storage_policies.sql`.
   - Create bucket `company-logos` (public). Confirm public read policy is active.

2. **Upload**
   - Log in as **super_admin** → open drawer → **Company Logo**.
   - Pick an image from the gallery. Check Metro logs for `[companyService] uploadLogo` (fileName, fileUri, contentType, arrayBufferByteLength, publicUrl).
   - In Supabase Storage → `company-logos`, confirm a **new** file exists (e.g. `company-<uuid>-<timestamp>.png`) and is not 0 bytes; open it to confirm it is not blank.

3. **Rendering**
   - Go to Admin Dashboard. Check Metro for `[AdminDashboard] company.logo_url: <url>` and `[AdminDashboard] Logo loaded successfully`.
   - If you see `[AdminDashboard] Logo failed to load`, the URL may be wrong or the bucket may not be public/readable; re-check bucket and storage policies.

4. **Safety**
   - If upload fails (e.g. network error), the database must **not** be updated (no new `logo_url`). Check that the previous logo still appears until a successful upload.
