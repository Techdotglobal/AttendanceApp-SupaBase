# Legacy database SQL

These files used to live at the repository root under `migrations/`. They document the evolution of the schema (RLS, multi-tenant `company_id`, etc.) and may still be useful as **read-only reference** or for one-off fixes in the Supabase SQL editor.

**Do not** copy them wholesale into `supabase/migrations/` for `db push` unless you know the remote database has never received equivalent changes — that would risk duplicate objects or conflicts.

For all **new** schema changes, use the CLI:

```bash
npm run db:new my_change_name
# edit supabase/migrations/<timestamp>_my_change_name.sql
npm run db:push
```
