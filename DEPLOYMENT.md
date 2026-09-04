# Demo deployment

Hosted stack: GitHub → Vercel → Supabase Postgres, Auth, and Storage.

Do not put passwords, service-role keys, or connection strings in git.

## 1. Create the Supabase project

1. Open [Supabase](https://supabase.com) and create a project.
2. Save the database password. It is shown only once.

## 2. Database connection

1. In Supabase go to **Project Settings → Database**.
2. Copy the **URI** connection string.
3. For Vercel, prefer the **transaction pooler** (port `6543`).
4. Replace the password placeholder with the database password.
5. Put that value in `DATABASE_URL`. Never commit it.

Request handling does **not** apply migrations. Schema changes must be applied explicitly before the new application code serves traffic.

To apply migrations and verify the connection, put `DATABASE_URL` in `.env.local` (or export the production URI) and run:

```bash
npm run db:migrate
```

`npm run db:setup` is the same command. It uses an advisory transaction lock, applies any missing files from `migrations/*.sql`, then prints `connected:` and `carriers table reachable`. Historical SQLite files remain in `migrations/sqlite/` for reference only.

Do this against the production `DATABASE_URL` before deploying application code that requires a new migration. This incident does not add a schema change.

## 3. Storage

1. In Supabase go to **Storage**.
2. Create a **private** bucket named `commission-statements`.
3. Do not make the bucket public. The app downloads files with the service-role key.
4. Set `SUPABASE_STORAGE_BUCKET=commission-statements`.

The Vercel deployment fails closed if Supabase Storage is unavailable; it never falls back to Vercel's temporary local filesystem.

Original Excel files are stored as `statements/{id}-{filename}`. The statement record still keeps original filename, display name, paid month, and carrier.

## 4. Auth

1. In Supabase go to **Authentication → Providers**.
2. Enable **Email**.
3. Disable public sign-up if available, or leave sign-up unused. The login page only signs in existing users.
4. In **Authentication → Users**, add the Product Owner user (email + password).
5. Set `DEMO_ALLOWED_EMAILS` to that email so only that account can open the demo.

Database migrations enable row-level security and remove direct `anon` and `authenticated` access to the application tables. The browser uses Supabase only for authentication; application data access goes through authenticated Next.js routes and the server-side database connection.

## 5. API keys

In **Project Settings → API** copy:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

The service-role key is server-only. Do not expose it in client code or screenshots.

## 6. GitHub

1. Create a GitHub repository for this project.
2. Commit the application. Confirm `.env*` files are not included. `.env.example` is safe to commit.
3. Push the branch.

## 7. Vercel

1. Import the GitHub repository into Vercel.
2. Framework preset: **Next.js**.
3. Select Node.js **22.x or newer**. Text-based PDF extraction requires Node.js 22 or newer.
4. Add environment variables:

   - `DATABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STORAGE_BUCKET` (`commission-statements`)
   - `DEMO_ALLOWED_EMAILS` (required for this private demo)
   - `ENABLE_REGISTRATION=false` (change to `true` only when intentionally allowing sign-up)

5. If this release includes a new file in `migrations/`, run `npm run db:migrate` against the production `DATABASE_URL` first. Then deploy.

## 8. Verify the demo

1. Open the Vercel URL. You should be redirected to **Sign in**.
2. Commission pages and `/api/*` should not be readable while signed out.
3. Sign in with the Product Owner user.
4. Create a carrier or upload an Excel statement and assign a carrier during intake.
5. Confirm the statement list shows the carrier and that **Download** returns the original file.
6. Confirm a new commission or posted Excel row still keeps paid month, optional premium month, and stored compensation snapshots.
7. Sign out, sign back in, and test **Forgot password** before sharing the demo.

## Local development

Copy `.env.example` to `.env.local` and use the same Supabase project, or a local Postgres URL.

```bash
npm install
npm run db:migrate
npm run dev
```

If Supabase Auth variables are omitted on your laptop, pages stay open so local work can continue. On Vercel those variables are required; anonymous access is blocked.

Tests use in-memory Postgres (PGlite) and do not need live credentials:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
