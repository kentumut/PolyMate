# Migration handoff — Bartek

Add ordered, immutable SQL migrations here (`0001_name.sql`, then `0002_name.sql`). The tooling runner applies them transactionally, records SHA-256 checksums, and refuses changes to applied migrations. Generate/review the SQL from the agreed Drizzle schema. No application tables are invented by Kent's scaffold.

Run `pnpm db:migrate` with DATABASE_URL set. The initial no-migrations result is explicit; it does not claim the OAuth schema is ready.
