# Transportation Management System

Next.js 14 (App Router) + TypeScript + Tailwind CSS, with Prisma on Supabase Postgres, deployed on Vercel.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in the Supabase values
npm run dev
```

The app runs at http://localhost:3000.

## Database

- `DATABASE_URL` is the Supabase transaction pooler (port 6543) and is used at runtime.
- `DIRECT_URL` is the session pooler (port 5432) and is used for schema changes.
- Models live in `prisma/schema.prisma`. Apply schema changes with `npm run db:push`.

## Deploying

Import the repository into Vercel and set the variables from `.env.example` in the project settings.
