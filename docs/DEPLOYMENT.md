# Deployment

Authoritative owner: **Alex**, with **Ben** review when connection, migration, or security procedure changes.

Do not put passwords, service-role keys, or connection strings in git.

Hosted stack: GitHub → Vercel → Supabase Postgres, Auth, and Storage.

Current production SHA and migrate state: [`RELEASE_STATUS.md`](RELEASE_STATUS.md).

## 1. Supabase project

1. Create the project and save the database password.
2. Enable Email auth. Add the Product Owner user.
3. Create a **private** Storage bucket `commission-statements`.

## 2. Database URL

1. Project Settings → Database → URI.
2. For Vercel use the **transaction pooler** (port `6543`).
3. Put it in `DATABASE_URL`. Never commit it.

The app uses `prepare: false` and the pooler-safe options in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 3. Migrations (explicit only)

Runtime requests **do not** apply migrations.

Before deploying application code that requires a new `migrations/*.sql` file, apply it against that environment’s `DATABASE_URL`:

```bash
npm run db:migrate
```

`npm run db:setup` is the same script. It takes an advisory transaction lock, applies missing files from `migrations/`, then prints `connected:` and `carriers table reachable`.

This documentation release adds **no** schema file. Production already has **0001–0006**. Do not run migrate for a docs-only commit.

Historical SQLite files in `migrations/sqlite/` are not applied.

## 4. Environment variables

See `.env.example`.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Pooler URI on Vercel |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Auth only |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; Storage |
| `SUPABASE_STORAGE_BUCKET` | `commission-statements` |
| `DEMO_ALLOWED_EMAILS` | Required on Vercel |
| `ENABLE_REGISTRATION` | Keep `false` unless sign-up is intentional |
| `DATABASE_SSL` | `disable` only for local non-SSL Postgres |
| `STORAGE_DRIVER` / `IMPORT_STORAGE_PATH` | Local filesystem fallback only |

Vercel does not fall back to ephemeral disk when Storage is missing.

## 5. GitHub and Vercel

1. Push the approved commit to `main` only when Alex authorizes.
2. Vercel: Next.js, Node 22+.
3. If the release includes a new migration, `db:migrate` first, then deploy.
4. Confirm the production SHA before Tom’s production QA.

## 6. Local

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

If Auth vars are omitted locally, pages stay open. On Vercel they are required.

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## 7. Production data safety

Do not post commissions, delete or recreate production statements, or rewrite payouts to “test” a deploy. Statement 4 and posted financial history are not disposable fixtures.
