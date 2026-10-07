This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Local database (fast development)

The cloud database is far from where most development happens, which makes every query slow. A local copy runs in Docker:

1. Start Docker Desktop, then: `npm run db:start` (first run downloads images and applies all migrations plus `supabase/seed.sql`).
2. `npm run db:local` writes `.env.development.local` from the running stack. `npm run dev` then uses the local database; `.env.local` (cloud) is untouched and still used by `npm run build` / `npm start`.
3. Upload your test transcripts again: the local database starts empty.

Useful: `npm run db:reset` rebuilds the local database from the migrations; `npm run db:stop` stops it; deleting `.env.development.local` points dev back at the cloud database. Studio (a local database browser) is at http://127.0.0.1:54323. Anything that needs the Python stats parser (`PARSE_STATS_FILE_URL`) is not available locally. Model calls still use your `ANTHROPIC_API_KEY` over the internet.


## Backups

`npm run backup` dumps the cloud database (schema and data) and downloads every uploaded file into `backups/<date>/`, with a manifest of row counts. `npm run backup -- --local` does the same for the local Docker database. Docker must be running.

`npm run restore -- backups/<folder>` rebuilds the **local** database from that backup (it empties the local copy first), puts the files back and checks every row count and the file count against the manifest. It never writes to the cloud project. A backup you have not restored is not a backup, so run a restore test after the first backup and then monthly.

The `backups/` folder contains client data and is git-ignored. Copy it somewhere off this laptop (an encrypted drive or cloud storage). Plan: weekly while it is just us, daily once real users are on the app.
