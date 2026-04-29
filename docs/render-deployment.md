# Abbot Study Render Deployment

This guide takes the current stack from local Docker development to a Render-hosted test deployment.

## Current Readiness

As of April 28, 2026, the app is close to deployment-ready:

- frontend production build passes
- backend migrations and test suites are in place
- admin analytics console exists
- worker-based document processing is configured
- Render blueprint is included in [render.yaml](/C:/Users/thedi/study-platform/render.yaml)

The main production requirement beyond standard secrets is shared media storage for uploaded PDFs, because uploads are processed by a separate worker service.

## Services

The Render blueprint creates:

- `abbot-study-web`: Next.js frontend
- `abbot-study-api`: Django backend
- `abbot-study-worker`: Celery background worker
- `abbot-study-db`: Postgres database
- `abbot-study-redis`: Redis-compatible key value store

## Required Secrets

Render will prompt you for these values on first deploy:

- `OPENAI_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_STORAGE_BUCKET_NAME`
- `AWS_S3_REGION_NAME`
- `AWS_S3_ENDPOINT_URL`
- `AWS_S3_CUSTOM_DOMAIN` (optional but recommended)

## Why Shared Object Storage Is Required

Uploaded study documents are stored as Django `FileField` media and then processed by the worker. On Render, the web service and worker run separately, so local container disk is not a reliable shared source of uploaded files.

Use an S3-compatible bucket such as:

- Cloudflare R2
- AWS S3
- Backblaze B2 S3-compatible buckets

Set `USE_S3_MEDIA_STORAGE=1` and provide the bucket credentials above.

## Render Deployment Steps

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from the repo root.
3. Confirm Render detects [render.yaml](/C:/Users/thedi/study-platform/render.yaml).
4. Provide the required secret values during setup.
5. Wait for the first deploy to finish.
6. Open the backend health check:
   - `/health/`
7. Open the frontend app and create a fresh learner account.
8. Run the learner journey smoke test in [mvp-smoke-test.md](/C:/Users/thedi/study-platform/docs/mvp-smoke-test.md).

## Backend Runtime Notes

The backend now uses:

- `gunicorn` for the web server
- `WhiteNoise` for static files
- `dj-database-url` for managed Postgres configuration
- secure cookie and HTTPS-aware settings when `DEBUG=0`

## Frontend Runtime Notes

The frontend now supports same-origin proxying in production:

- the browser talks to the frontend domain
- Next.js rewrites `/api/*`, `/media/*`, and `/health`
- the frontend forwards those requests to the backend over Render's private network

This reduces deployment friction compared to relying on public cross-origin API calls.

## Post-Deploy Checks

Run these checks in the deployed environment:

1. Sign up and log in.
2. Create a subject.
3. Upload a PDF.
4. Confirm the upload moves from `uploaded` to `processing` to `ready`.
5. Open the subject progress page.
6. Start a topic in the tutor.
7. Confirm the worker-generated syllabus appears and the tutor responds normally.
8. Log in as an admin and open `/admin` in the app shell.

## Security Defaults Included

When deployed with `DEBUG=0`, the project is configured for:

- `SECURE_SSL_REDIRECT`
- secure session and CSRF cookies
- HSTS support
- `X-Frame-Options: DENY`
- `nosniff`
- `same-origin` referrer / COOP defaults

## Tighten Before Public Launch

For a private or small beta, the current setup is good. Before a wider launch, tighten these:

- replace broad `.onrender.com` trust settings with exact frontend domains
- add password reset and email verification
- add rate limiting for login and signup
- move OpenAI and storage credentials into a dedicated secret-management workflow
- add error monitoring such as Sentry

## Useful Commands

Local deployment-style checks:

```powershell
docker compose exec backend python manage.py check --deploy
docker compose exec backend python manage.py migrate --check
cd frontend
npm run build
```
