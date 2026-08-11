# supabase-app

A Next.js (App Router) frontend backed by Supabase (Postgres + Auth) and
Google Cloud Storage (file uploads). Live at
https://supabase-app-olive.vercel.app.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **Supabase**: Postgres database + `@supabase/ssr` for the browser/server
  clients (see [`src/utils/supabase/`](src/utils/supabase/))
- **Google Cloud Storage**: file uploads via a service account scoped to a
  single bucket (see [`src/utils/gcs/client.ts`](src/utils/gcs/client.ts))
- **Vercel**: hosting/deployment

## Pages

| Route       | What it does                                                                    |
| ----------- | --------------------------------------------------------------------------------- |
| `/`         | Home page; reports whether the Supabase connection is configured and working.    |
| `/netflix`  | Browses/searches the 25,000-row `netflix_users` table (paginated).               |
| `/uploads`  | Uploads a file to GCS and records its metadata in the Supabase `files` table.    |

## Local setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from the
     Supabase dashboard: Project Settings → Data API / API.
   - `GCS_BUCKET_NAME` / `GCS_SERVICE_ACCOUNT_KEY_BASE64` — see
     [Google Cloud Storage setup](#google-cloud-storage-setup) below.
3. Run the Supabase schema: see [`supabase/README.md`](supabase/README.md).
4. `npm run dev` → http://localhost:3000

## Supabase setup

Schema, RLS policies, and how the `netflix_users` dataset was imported are
documented in [`supabase/README.md`](supabase/README.md). The canonical
schema lives in [`supabase/schema.sql`](supabase/schema.sql) — run it once in
the Supabase SQL Editor against a fresh project.

RLS is enabled on every table; the anon/publishable key is safe to ship in
the frontend because RLS policies (not the key itself) control what it can
do. `service_role`/secret keys are never used in this app.

## Google Cloud Storage setup

Uploads go to a GCS bucket via a service account scoped to **only that
bucket** (`roles/storage.objectAdmin` on the bucket, not the project):

- GCP project: `instant-gecko-483809-i7`
- Bucket: `gs://hsehub-instant-gecko-i7`
- Service account: `supabase-app-gcs@instant-gecko-483809-i7.iam.gserviceaccount.com`

To reproduce this setup on a different project/bucket:

```bash
gcloud config set project <PROJECT_ID>
gcloud services enable storage.googleapis.com
gcloud storage buckets create gs://<BUCKET_NAME> --location=us-central1 --uniform-bucket-level-access
gcloud iam service-accounts create <SA_NAME> --display-name="<description>"
gcloud storage buckets add-iam-policy-binding gs://<BUCKET_NAME> \
  --member="serviceAccount:<SA_NAME>@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
gcloud iam service-accounts keys create ./key.json \
  --iam-account=<SA_NAME>@<PROJECT_ID>.iam.gserviceaccount.com
```

The resulting `key.json` is never committed. Instead it's base64-encoded and
stored as the `GCS_SERVICE_ACCOUNT_KEY_BASE64` env var (both locally in
`.env.local` and in Vercel's project env vars) — [`src/utils/gcs/client.ts`](src/utils/gcs/client.ts)
decodes it at runtime. Downloads are served through short-lived (15 min)
signed URLs, not public bucket access.

```bash
base64 -w0 key.json   # value to store in GCS_SERVICE_ACCOUNT_KEY_BASE64
```

A local copy of the key is kept at `.secrets/gcs-service-account.json` —
that directory is gitignored and must never be committed.

## Deployment

Hosted on Vercel, project `hse-hub/supabase-app`.

```bash
npx vercel link --yes --project supabase-app   # one-time, already done
npx vercel env add <NAME> production           # set/update an env var
npx vercel deploy --prod --yes                 # ship the current code
```

Production env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`GCS_BUCKET_NAME`, `GCS_SERVICE_ACCOUNT_KEY_BASE64`) are set directly on
Vercel and are **not** derived from `.env.local` automatically — update both
when a value changes.

Every push to `master` on GitHub does **not** yet auto-deploy — see
[Working procedure](#working-procedure) below.

## Working procedure

- Every change gets committed and pushed to
  [github.com/hitul-hse/supabase-app](https://github.com/hitul-hse/supabase-app)
  so GitHub reflects the actual state of the app.
- New/changed Supabase tables or policies get added to
  [`supabase/schema.sql`](supabase/schema.sql) (or documented as a one-off
  procedure in [`supabase/README.md`](supabase/README.md) if they're not
  meant to be re-run, like the `netflix_users` import).
- After pushing, redeploy to Vercel (`npx vercel deploy --prod --yes`) so
  production matches `master`.
