# Production requirements

The local application is sandbox software. No deployment was performed. Before public production use:

1. Remove fictional seed accounts, rotate credentials, provision authenticated TLS PostgreSQL and encrypted backups, test restore, review migrations and retention. Production seed execution is disabled.
2. Configure HTTPS/domain, exact APP_URL, secrets manager and production SMTP with verified sending domain. Review proxy/rate-limit boundaries.
3. Provision private S3 storage with public access blocked, restrictive credentials and encryption. Local media storage is disabled in production. Add scanning, isolated decoding/transcoding, upload quotas, review and retention/deletion procedures.
4. Integrate an approved payment provider supporting the business. Verify subscription, renewal, failure, dispute, refund and payout lifecycle using its test environment. Existing sandbox confirmations are not real charges or transferable balances. Real automatic billing and payouts are unavailable.
5. Complete jurisdiction-appropriate age assurance, creator identity review, consent evidence, content moderation and takedown procedures. Checkbox acceptance and a manually approved badge do not prove identity/age. Do not collect identity documents through messages/posts. Production publishing/checkout requires approved creator status and explicit `PRODUCTION_SAFETY_APPROVED=true` after these processes are in place; the flag alone does not establish compliance.
6. Obtain reviewed legal policies, operator identity, support contacts and consumer cancellation/refund procedures. Informational legal pages are not a completed legal review.
7. Establish observability, incident response, audit retention, privacy export/deletion workflows and financial retention. Load-test, accessibility-audit and independently penetration-test the deployed environment.
8. Verify actual deployed SHA, external services and complete live journeys. Local build/tests do not establish production availability or real money movement.

Security headers restrict resources to same-origin and disallow framing. The baseline CSP permits inline scripts/styles and eval for framework development; production should use nonces and remove eval. Authenticated JSON and media must never enter a shared CDN cache.
