#!/bin/sh
set -e

# Bring the database schema up to date, then optionally load demo data.
npx prisma db push --skip-generate

if [ "$SEED_DEMO_DATA" = "true" ]; then
  ALLOW_DEMO_SEED=true npx tsx prisma/seed.ts
fi

exec npx next start -p 3000
