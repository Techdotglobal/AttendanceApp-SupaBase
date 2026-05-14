# Company Logos Storage Setup

Create the storage bucket **before** running the storage policies SQL.

## Steps in Supabase Dashboard

1. Open your project at [Supabase Dashboard](https://app.supabase.com).
2. Go to **Storage** in the left sidebar.
3. Click **New bucket**.
4. Set:
   - **Name:** `company-logos`
   - **Public bucket:** **Yes** (so the app can show logo via public URL)
   - Leave **Allowed MIME types** empty or set to `image/*` if you want to restrict to images only.
5. Click **Create bucket**.

## After creating the bucket

Run the SQL in **supabase/legacy_migrations/021_company_logos_storage_policies.sql** in the Supabase **SQL Editor** to apply RLS policies:

- Public read for `company-logos` objects
- Only `super_admin` can INSERT/UPDATE/DELETE in `company-logos`

## File path used by the app

Uploads use the path:

```
company-logos/company-{companyId}.png
```

Example: `company-logos/company-a1b2c3d4-e5f6-7890-abcd-ef1234567890.png`
