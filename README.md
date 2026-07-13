# AdFlow

AdFlow is an internal ad creative management and approval system for marketing teams.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth, Postgres, Storage, Realtime, and RLS
- Realtime in-app notifications
- Google OAuth and Google Drive metadata/thumbnail integration
- Tailwind, TipTap, TanStack Table, Recharts, Vitest, and Playwright

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill the values.

3. Create a Supabase project and run `supabase/migrations/0001_init.sql` in the SQL editor or with the Supabase CLI.

4. In Supabase Auth, enable Email/Password and Google OAuth. Use these callback URLs:

   ```text
   http://localhost:3000/auth/callback
   https://your-production-domain.com/auth/callback
   ```

5. For Google Drive thumbnails/metadata, share Drive files with the configured service account or make them accessible to signed-in reviewers.

6. Start the app:

   ```bash
   npm run dev
   ```

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run e2e
```

The app validates configuration at runtime. Pages still render a setup state if live credentials are missing, but live auth and data operations require Supabase environment variables.
