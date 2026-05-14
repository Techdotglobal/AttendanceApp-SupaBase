# Supabase (this repo)

- **`migrations/`** — SQL managed by the [Supabase CLI](https://supabase.com/docs/guides/cli).  
  New work: `npm run db:new <name>` then `npm run db:push` after `db:login` / `db:link`.

- **`legacy_migrations/`** — Historical numbered SQL files that were applied manually or before the CLI was adopted. They are **not** run by `supabase db push` (only `migrations/` is). Keep them for reference and for reproducing old environments.

- **`config.toml`** — Local dev defaults for `supabase start` (ports, Postgres major version, etc.).

## Duplicate companies (merge + prevent)

If onboarding was run multiple times with the same display name, you can end up with several `companies` rows that differ only by `id`. Migration **`supabase/migrations/20260514120000_merge_duplicate_companies.sql`** collapses rows into three canonical tenants (**Netkom Communications KSA**, **TDG**, **TechDotGlobal**) by name pattern, merges `departments` / `users` / `sites`, deletes empty junk tenants, and adds a **unique index** on the normalized name so Postgres rejects future duplicates.

After `db push` (or running that SQL in the dashboard), refresh JWT claims so mobile/web see the new `company_id`:

```bash
npm run sync-auth-metadata
```

(Uses `services/auth-service/.env` — needs `SUPABASE_SERVICE_ROLE_KEY`.)

Onboarding now also returns **409** if a company name already exists (case-insensitive, spaces normalized).
