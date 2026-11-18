# FollowersOnly

An independently implemented creator subscription application. Reference UI research was performed with REA in an authorized browser session; no reference source, branding, creator assets or account data are included.

## Run locally

Requires Node.js 22.23.4+ and PostgreSQL tools (`initdb`, `pg_ctl`, `psql`, `createdb`) on PATH. The machine's existing isolated Node 22 binary is `/Users/gokulr/.local/share/rea-runtime/node_modules/node/bin/node`; optionally prepend its directory to PATH for this project. No Docker daemon is required.

```sh
cd /Users/gokulr/Developer/GitHub/Followers_Only
npm ci
npm run env:init
npm run db:local
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://127.0.0.1:3100. The existing `Followers_Only` directory is intentionally reused; there is no duplicate `FollowersOnly` directory. A separate local Git repository is initialized here; no remote is configured and no unrelated checkout is modified.

Development seed accounts all use password `FollowersOnly!2026`:

| Email | Role |
| --- | --- |
| alex@followersonly.test | Subscriber |
| maya@followersonly.test | Creator |
| theo@followersonly.test | Creator |
| luna@followersonly.test | Creator, free subscription |
| kai@followersonly.test | Creator |
| admin@followersonly.test | Administrator |

These identities and all seed artwork are fictional. Seed is idempotent, preserves existing accounts and refuses production execution. It does not create financial success records.

## Verification and recovery mail

Local registration and password recovery write messages to `.local/mail` with restricted filesystem permissions. Open the newest corresponding text file locally and follow its link. Tokens are single-use, expire and are stored hashed in PostgreSQL. Local outbox delivery is intentionally unavailable in production. Set `MAIL_MODE=smtp`, `SMTP_URL` and `MAIL_FROM` for an actual mail transport.

## Billing

All billing is **sandbox only**. Checkout creates a pending transaction. Explicit sandbox confirmation produces an HMAC-signed provider event; only verified provider events grant subscription access and affect financial records. No card entry, charge or real payout occurs. Cancellation preserves access to the paid-through date; sandbox renewal preferences do not create automatic real charges. Refunds are test-mode events. The provider interface deliberately refuses production billing until a real provider and its lifecycle are implemented and approved.

Webhook endpoint: `POST /api/webhooks/payments`, HMAC-SHA256 over the exact JSON request bytes in `x-fo-signature`, using `PAYMENT_WEBHOOK_SECRET`. Events include `id`, `transactionId`, `type` and millisecond `timestamp`; replay IDs and stale timestamps are checked. Signing secrets must stay server-side.

## Storage and video

Local development media lives in ignored `.local/media`, outside `public`. Every retrieval uses `/api/media/:id` and a fresh server authorization check; storage keys are never sent to clients. Public profile assets and public posts are intentional exceptions to subscription gating. Uploads validate actual file signatures, allowed formats, ownership, purpose and size. JPEG/PNG/WebP and MP4/WebM up to 10 MB are supported (profile images: 5 MB). Video playback is native HTML media; processing state is modeled for a future isolated transcoding/scanning worker. Production requires private S3-compatible storage, encryption, restrictive bucket policy and a reviewed processing pipeline. No presigned public URLs are used.

## Commands

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm start
npm run db:stop
```

Browser/API integration tests need the local database and application running. Set `CHROME_EXECUTABLE` to a compatible installed Chromium executable if needed; the configuration otherwise prefers an installed Playwright browser and falls back to system Chrome. Tracing is disabled because the local Chrome157/Playwright combination hung during earlier failed-test trace cleanup. Tests create uniquely named fictional accounts in the local database; do not run them against production. See the Playwright configuration for browser executable and server behavior.

## Documentation

- [REA verification](docs/REA_SETUP_AND_VERIFICATION.md)
- [Reference observations and limitations](docs/REFERENCE_RESEARCH.md)
- [Feature and phase inventory](docs/FEATURE_INVENTORY.md)
- [Original design system](docs/DESIGN_SYSTEM.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment requirements](docs/PRODUCTION_REQUIREMENTS.md)
- [Verification results](docs/FINAL_VERIFICATION.md)
