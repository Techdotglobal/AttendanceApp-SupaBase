# Supabase (this repo)

- **`migrations/`** — SQL managed by the [Supabase CLI](https://supabase.com/docs/guides/cli).  
  New work: `npm run db:new <name>` then `npm run db:push` after `db:login` / `db:link`.

- **`legacy_migrations/`** — Historical numbered SQL files that were applied manually or before the CLI was adopted. They are **not** run by `supabase db push` (only `migrations/` is). Keep them for reference and for reproducing old environments.

- **`config.toml`** — Local dev defaults for `supabase start` (ports, Postgres major version, etc.).
