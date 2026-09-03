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

The app applies the numbered Postgres migrations on first database open. Migration execution is transaction-protected and serialized across application instances. Historical SQLite files remain in `migrations/sqlite/` for reference only.

To apply migrations and verify the connection from your laptop, put `DATABASE_URL` in `.env.local` (or export it) and run:

```bash
npm run db:setup
```

A successful run prints `connected:` and `carriers table reachable`.

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
3. Add environment variables:

   - `DATABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STORAGE_BUCKET` (`commission-statements`)
   - `DEMO_ALLOWED_EMAILS` (required for this private demo)
   - `ENABLE_REGISTRATION=false` (change to `true` only when intentionally allowing sign-up)

4. Deploy.

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
npm run db:setup
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
