# Security, privacy and compliance

## Authentication
- Email + password; passwords hashed with PBKDF2-HMAC-SHA256 (600,000 iterations, per-user salt, constant-time compare).
- Short-lived JWT access tokens (15 min, HS256) bound to a server-side session; refresh tokens are random, stored only as SHA-256 hashes, rotated on every use, and reuse revokes the session.
- Email verification and password reset via single-use hashed tokens (24 h / 30 min). Reset revokes all sessions. Responses do not reveal whether an email exists.
- Account lock after 5 failed attempts for 15 minutes; auth routes are rate-limited (10/min/IP).
- **MFA for administrators and support staff**: one-time 6-digit code by email, 10-minute expiry, 5 attempts. The `MessageChannel` port allows TOTP/SMS later.
- Social sign-in: the identity service issues sessions from a verified user id, so an OAuth provider can be added as another entry point without changing authorization.

## Authorization
- Role-based access control with five roles (consumer, merchant admin, store employee, platform admin, operations & support) and 32 permissions, synced to `roles`/`permissions`/`role_permissions` on migrate.
- Enforced on **every API route** in `dispatch()`; the web app's route guards are UX only.
- Store scoping: merchant admins act on stores of their business; employees act only on assigned stores and only within granted capabilities (e.g. update stock but not prices). Employees never receive owner access automatically.
- Operations & support can onboard merchants, verify stores, moderate content and resolve order disputes, but have no refunds, settings, role management or audit-log access.

## Application security (OWASP-aligned)
- Input validation with Zod on every body and query; field-level error details.
- SQL injection: parameterized queries only; identifiers whitelisted.
- XSS: React output encoding; no `dangerouslySetInnerHTML`; strict CSP on the web container and API.
- Helmet security headers, `X-Request-Id`, no `X-Powered-By`, `Cache-Control: no-store` on API responses.
- CSRF: the API uses bearer tokens (no ambient cookies), so CSRF does not apply; if a cookie-based BFF is added, use SameSite=strict cookies plus CSRF tokens.
- Rate limiting per route class; idempotency keys on checkout, store-to-store creation and refunds.
- Audit log (append-only by trigger): actor, action, entity, before/after values, IP and user agent.

## Payments (PCI-conscious)
- Card data never reaches RetailGeo servers: the browser tokenizes with the processor's hosted fields (Stripe Elements in production) and the API receives only a payment-method token.
- Authorize at checkout, capture when the store marks the order ready, void or refund on cancellation. Partial refunds supported. All transactions are logged for reconciliation.

## Infrastructure (AWS target)
Private subnets for RDS and ElastiCache, security groups allowing only the ECS tasks, TLS everywhere (ACM on ALB/CloudFront), AWS WAF managed rules, Secrets Manager for credentials, least-privilege IAM task roles, CloudWatch logs/alarms, automated RDS backups with PITR, and a documented restore drill. See `deployment-aws.md`.

## Operational security
Dependency audit, CodeQL, secret scanning and container image scanning run in CI. Penetration testing is required before production launch.

## Privacy by design
- Location permission is requested only on an explicit tap; the current search location lives in the browser session and is kept separate from saved addresses.
- Search logs store location rounded to ~1 km; retention is configurable (`privacy.search_log_retention_days`, default 180).
- Users can view/export their data and delete their account (personal data anonymized, orders retained de-identified for accounting).
- Marketing email is opt-in and separate from transactional messages. SMS is disabled until consent capture and a provider are in place.

## Compliance considerations
State privacy laws (e.g. Texas TDPSA, CCPA/CPRA for future markets), consumer protection, sales-tax collection, accessibility (WCAG 2.2 AA target), payment security (PCI DSS SAQ-A scope with hosted fields), marketing consent (CAN-SPAM, TCPA for SMS), data retention and deletion. **These are design inputs, not certifications. Final applicability must be confirmed by qualified legal and compliance professionals.**
