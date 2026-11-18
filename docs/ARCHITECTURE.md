# Architecture

Next.js App Router, React, TypeScript and Tailwind CSS provide an original consumer application shell. Route handlers validate commands with Zod and use Prisma against PostgreSQL. UI authorization improves navigation; every protected read and operation is independently checked server-side.

## Modules

- `src/app/api/[...path]/route.ts`: API queries/commands and role/ownership checks.
- `src/app/api/media/[id]/route.ts`: independently authorized private media proxy.
- `src/app/api/webhooks/payments/route.ts`: signed provider event ingress.
- `src/lib/security.ts`: opaque sessions, authorization, entitlement, CSRF origin checks, PostgreSQL rate limiting and audits.
- `src/lib/queries.ts`: scoped reads and safe serialization.
- `src/lib/payments.ts`: provider interface and transactional sandbox lifecycle.
- `src/lib/storage.ts`: local/S3 adapter and signature-based upload validation.
- `src/lib/mail.ts`: SMTP/local development outbox transport.
- `prisma/schema.prisma`, `prisma/migrations`: normalized relational schema and versioned migrations.
- `prisma/seed.ts`: fictional accounts and independently generated artwork.

## Invariants

Username/email are unique. bcrypt hashes passwords. Random session and recovery tokens are stored as hashes. HttpOnly/SameSite cookies become Secure in production. Sessions expire and suspension revokes access.

Posts own ordered media joins, comments, likes and bookmarks. Locked bodies and attachment identifiers are omitted before serialization. Every media read checks current entitlement, ownership, publication, moderation and conversation membership. Private profile settings affect discovery and content reads.

Subscriptions are unique per subscriber/creator pair. Integer minor units, immutable price snapshots, unique idempotency keys and replay-protected events support transactional accounting. Only verified provider events grant paid access. All records identify sandbox mode; no real settlement or payout is implied. Payout records model a future provider lifecycle.

Conversations use unique normalized participant-pair keys and membership rows. Messages/media require membership and settings allow recipient opt-out. Notifications belong to a recipient. Moderation, reports and administrator commands generate audit records.

## Real-time architecture

Clients refresh conversation data on a bounded polling interval. Durable messages and unread state live in PostgreSQL. This enables cross-session updates without an in-memory bus. A future authenticated SSE/WebSocket gateway can consume a durable outbox while reusing membership checks. Polling is implemented; WebSocket delivery is not claimed.

## Infrastructure

Local PostgreSQL lives in `.local/postgres`, loopback port 55439 with development-only trust authentication. Production uses authenticated TLS PostgreSQL, private S3-compatible storage and SMTP; local storage/mail adapters refuse production. Environment secrets are ignored by Git.

Use `prisma migrate deploy` for deployment. Back up data/media first. Roll back application code independently; use reviewed forward migrations for destructive schema changes.

## External references

- [Next.js asynchronous cookies](https://nextjs.org/docs/app/api-reference/functions/cookies)
- [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication)
- [Prisma deployment migrations](https://docs.prisma.io/docs/cli/migrate/deploy)

Versions were checked against npm and the package-lock is retained. Prisma 6 is intentionally pinned and its installed CLI was exercised; newer major-version documentation is not treated as proof of the pinned API.
