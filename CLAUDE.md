# CLAUDE.md - TNC Web Platform (Thanh Nhàn Cosmetic)

> Instructions for Claude Code working in this repository. Read this entire file before writing code. When a rule here conflicts with a generic habit or a tutorial, this file wins.

> **Cập nhật 2026-10-14 — stack đã đổi.** Dự án chuyển từ Spring Boot + MySQL sang **NestJS + Prisma + Supabase Postgres**; xem `prisma/schema.prisma`, `prisma/migrations/`, `docs/banking-design-review.md`. Các quy tắc chất lượng trong file này (transaction, tiền tệ là Decimal, audit, guardrails, testing) vẫn giữ nguyên hiệu lực; mọi chi tiết Spring Boot / MySQL / Flyway / Maven / JAXB / SOAP bên dưới đã lỗi thời và nên được thay bằng tương đương NestJS khi có dịp. Lệnh thực tế nằm trong `package.json`: `npm test`, `npm run typecheck`, `npm run build`, `npx prisma migrate deploy`.

## 0. Working agreements

- Reply to the user in Vietnamese. Keep code, identifiers, comments, logs, API contracts, and commit messages in English.
- For changes that touch more than one layer (controller -> service -> repository -> migration), post a short plan first, implement, then verify with tests.
- Keep diffs focused. Do not rename, reformat, or refactor code unrelated to the task.
- Never run `git commit`, `git push`, or create branches unless the user explicitly asks.
- When a business detail is unspecified (commission rate, reservation window, page size), pick a conservative default, expose it as an `application.yml` property, and state the assumption in your summary.
- Do not claim something works without running the relevant test. If a test cannot be run, say so explicitly.

## 1. Project overview

TNC Web Platform is the Spring Boot e-commerce backend for Thanh Nhàn Cosmetic. One system serves two business models:

- B2C retail: the platform sells new cosmetics. Products have bulk stock (e.g. 100 lipsticks), belong to a category, and can run flash sales.
- C2C second-hand: individual users list used cosmetics (quantity = 1) with condition details (usage percentage, remaining expiry date, purchase-proof image). Every listing must pass a staff approval workflow before it becomes publicly visible.

The bar is enterprise-grade: JSON REST APIs for web and mobile, a SOAP client integration with a legacy logistics/ERP partner, OAuth2 with role-based authorization, disciplined concurrency and transaction handling, and a Spring AOP audit trail.

## 2. Stack and version rules

| Concern | Choice |
| --- | --- |
| Language | Java 21 |
| Framework | Spring Boot 3.x |
| Build | Maven; use `./mvnw` (Windows: `mvnw.cmd`) |
| REST | Spring Web + springdoc-openapi (`/swagger-ui`) |
| SOAP | Spring Web Services (`spring-ws`); JAXB classes generated from WSDL |
| Security | Spring Security 6 + OAuth2 (JWT resource server; authorization_code + PKCE) |
| Persistence | Spring Data JPA / Hibernate + MySQL 8 |
| Schema | Flyway migrations only |
| Auditing | Spring AOP + `audit_logs` table |
| Mapping | MapStruct or explicit mappers; DTOs at every boundary |
| Tests | JUnit 5, Spring Boot Test, Testcontainers (MySQL), WireMock (SOAP partner) |

Rules:

- Flyway owns the schema. Never enable `spring.jpa.hibernate.ddl-auto=update` or `create` outside a throwaway local experiment; the committed value is `validate`.
- Money is `BigDecimal` mapped to `DECIMAL(12,2)`. Never `double` or `float`. Round commission with `RoundingMode.HALF_UP`.
- Store timestamps in UTC; convert to `Asia/Ho_Chi_Minh` only at the presentation layer.
- Use constructor injection. No field injection, no `@Autowired` on fields.
- Every new dependency needs an explicit version in `pom.xml` and a one-line justification in your summary.

## 3. Package layout

```
com.tnc.webplatform
+-- common/            # config, error handling, pagination, shared utilities
+-- security/          # SecurityConfig, JWT converters, method-security helpers
+-- audit/             # @Auditable, AuditAspect, AuditLog + repository
+-- user/              # profile, wallet
+-- catalog/           # categories, retail products, stock
+-- listing/           # second-hand listing submission + staff approval
+-- order/             # cart, checkout, order lifecycle
+-- payment/           # wallet payments, idempotency, gateway callbacks
+-- integration/soap/  # logistics/ (tracking), erp/ (accounting)
```

- Keep feature packages cohesive: controller, service, repository, entity, and DTOs live together.
- Controllers never expose JPA entities; always map to DTOs.
- Shared infrastructure lives in `common`, `security`, and `audit`, not inside feature packages.

## 4. REST API conventions

- Base path `/api/v1`, plural resource names (`/products`, `/listings`, `/orders`).
- Filtering through query params, e.g. `/products?type=SECONDHAND&categoryId=3&minCondition=90`.
- Pagination via Spring `Pageable` with a capped page size; return one consistent page DTO shape across endpoints.
- Errors: RFC 7807 `ProblemDetail` from a single `@RestControllerAdvice`, with a stable `code` field (`INSUFFICIENT_STOCK`, `ALREADY_RESERVED`, `RESERVATION_EXPIRED`, ...).
- Status codes: 201 + `Location` on create; 409 for conflicts and idempotency clashes; 400/422 for validation; distinguish 401 from 403 correctly.
- Checkout and payment endpoints require an `Idempotency-Key` header; a replay returns the original response instead of executing twice.
- Document every endpoint with springdoc annotations (summary, request/response examples). OpenAPI accuracy is part of the deliverable.

## 5. SOAP integration (legacy logistics / ERP)

Flow when an order becomes `READY_TO_SHIP`:

1. The order transaction commits and publishes a domain event.
2. A `@TransactionalEventListener(phase = AFTER_COMMIT)` listener builds and sends the SOAP request (order details + shipping address) to the partner.
3. The partner response is stored: tracking ID, raw response reference, timestamps.
4. On failure the sync record is marked `FAILED` and retried with backoff on a schedule. The committed order is never rolled back because of the partner.

Rules:

- WSDL-first: generate JAXB classes with a Maven plugin. Never hand-edit generated sources; never hand-build request XML strings.
- Send requests with `WebServiceTemplate`; configure connect and read timeouts; fail fast instead of hanging.
- Endpoint URLs and credentials come from config/environment; never hard-code them; mask secrets in logs and log a correlation ID.
- Never call the SOAP partner inside a database transaction. Persist intent first, call after commit, record the outcome.
- Isolate generated SOAP types in `integration/soap`; map them to internal models at the boundary. Business code does not depend on generated classes.
- Test with WireMock XML stubs: assert the generated request for a fixture order, plus timeout and SOAP fault paths.

## 6. Security and authorization

Roles (exactly these three, always with the `ROLE_` prefix):

- `ROLE_ADMIN`: full control, including staff management.
- `ROLE_STAFF`: approves/rejects second-hand listings, hides policy-violating posts, manages retail warehouse stock.
- `ROLE_USER`: customer/buyer; may also list second-hand items.

Rules:

- Enable method security (`@EnableMethodSecurity`) and put `@PreAuthorize` on service methods, not only on controllers.
- Identity always comes from the JWT via `SecurityContext`. Never trust `sellerId`, `userId`, or `ownerId` from request bodies or query params.
- Ownership checks go through a dedicated bean: use `@PreAuthorize` with a SpEL call such as `@listingSecurity.isOwner(#id, authentication)`, which loads the row and compares the owner.
- Staff/admin moderation (approve, reject, hide) requires `hasAnyRole('STAFF','ADMIN')` and always records a reason in the audit trail.
- Public endpoints: catalog browsing, search of approved second-hand listings, auth endpoints. Authenticated: cart, checkout, orders, own listings, wallet. Moderation endpoints live under `/api/v1/admin/**` or staff-only routes.
- OAuth2: authorization_code + PKCE. Never add the resource-owner password grant. Short-lived access tokens; refresh tokens hashed at rest if persisted.
- Passwords hashed with BCrypt (or Argon2). No secrets in the repo; use environment variables or a git-ignored `local` profile. Never log tokens, password hashes, or full PII.
- Do not disable CSRF, CORS, or security rules to make a test pass, even temporarily. Configure CORS with an explicit origin allow-list.

## 7. Data model rules

Core tables (start from the project brief's draft schema, then apply these adjustments):

- `categories(id, name)`
- `products(id, name, description, price, category_id, product_type, status, stock_quantity, seller_id, reserved_until, version, created_at, updated_at)`
- `secondhand_details(product_id, usage_percentage, expiry_date, purchase_proof_url)`
- `audit_logs(id, entity_type, entity_id, action, old_status, new_status, reason, actor_id, actor_role, ip_address, occurred_at, metadata)`
- Support tables to design later: `wallets`, `wallet_transactions`, `orders`, `order_items`, `idempotency_keys`, `outbound_sync` (SOAP tracking).

Rules:

- `product_type` is `RETAIL` or `SECONDHAND`. `seller_id` is NULL for retail and required for second-hand.
- Split the draft's ambiguous `PENDING` into two states. Second-hand lifecycle: `DRAFT -> PENDING_REVIEW -> AVAILABLE -> PENDING_PAYMENT -> SOLD`, plus `REJECTED` (moderation) and `HIDDEN` (staff took it down). Retail lifecycle: `AVAILABLE -> SOLD`, plus `HIDDEN`.
- MySQL `ENUM`: never reorder or remove values (ordinals are stored); append new values at the end in a new migration. In JPA always use `@Enumerated(EnumType.STRING)`.
- Enforce invariants in the database where practical: `CHECK (stock_quantity >= 0)`, `CHECK (price >= 0)`, NOT NULL for required foreign keys, indexes for lookups (status, category, type, seller).
- `reserved_until` is `DATETIME(6)`, nullable, set only while a second-hand item is `PENDING_PAYMENT`.
- Add `@Version` (optimistic locking) to `products` and `orders`; map optimistic-lock failures to HTTP 409.
- Enable JPA auditing (`@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`) with an `AuditorAware` that reads the `SecurityContext`.

## 8. Concurrency and transactions

Flash sale (retail, bulk stock):

- The stock decrement must be one atomic guarded statement, e.g.
  `UPDATE products SET stock_quantity = stock_quantity - :qty, version = version + 1 WHERE id = :id AND product_type = 'RETAIL' AND stock_quantity >= :qty`
  Success is one affected row. Zero affected rows means `INSUFFICIENT_STOCK` (409). Never read-then-update stock without a guard.
- When read-modify-write logic is unavoidable, use `@Lock(LockModeType.PESSIMISTIC_WRITE)` on the repository finder inside a short `@Transactional` service method. Acquire locks in a consistent order (e.g. ascending product id) to avoid deadlocks.
- `@Version` plus retry is acceptable for low-contention paths. Stock must never go negative, even with 100+ concurrent buyers; prove it with the concurrency test.

Second-hand reservation (unique item):

- Starting checkout reserves the item atomically:
  `UPDATE products SET status = 'PENDING_PAYMENT', reserved_until = :deadline, version = version + 1 WHERE id = :id AND product_type = 'SECONDHAND' AND status = 'AVAILABLE'`
  Zero rows means someone else took it; return 409 `ALREADY_RESERVED`.
- Reservation window is 10 minutes by default (`app.reservation.minutes`, configurable). A scheduled job runs every minute and releases expired `PENDING_PAYMENT` items back to `AVAILABLE`, writing an audit entry.
- The payment callback must verify the reservation still belongs to the order and has not expired before marking the item `SOLD`. Never assume the item is still held.

Transactions:

- `@Transactional` on service methods only; never on controllers or repositories. Keep transactions short and never call remote systems (SOAP/HTTP) inside them.
- Wallet checkout is a single transaction: validate idempotency key -> lock buyer wallet (pessimistic) -> check balance -> debit buyer -> credit seller minus commission -> append `wallet_transactions` ledger rows -> create order and invoice -> consume stock/reservation -> audit -> commit. Any failure rolls back everything; partial writes are never acceptable.
- Wallet balance is derived state: never update `wallets.balance` without a matching immutable ledger row.
- Idempotency: store key + request hash + response; replay with the same key returns the stored response; same key with a different payload is 409.
- Stay on `READ_COMMITTED` unless there is a documented reason. Prefer conditional updates and versioning over raising isolation levels.

## 9. Audit trail (Spring AOP)

- Annotate state-changing service methods with `@Auditable(entityType, action)`: listing approve/reject/hide, order status changes, wallet movements, stock adjustments.
- `AuditAspect` writes to `audit_logs`: who (actor id and role from `SecurityContext`), when (UTC), what (entity type and id, action), transition (old status -> new status), why (reason), plus request metadata (IP, user agent) and a JSON `metadata` column for extras.
- Audit writes for business state changes run in the same transaction as the change, so the log can never contradict the data.
- Aspects must never swallow or replace business exceptions, and must not change method return values.
- Keep the pointcut annotation-driven and narrow; do not intercept everything. Never log secrets or full payment payloads.

## 10. Errors and validation

- Bean Validation on request DTOs; return field-level details.
- Domain exceptions (`InsufficientStockException`, `ReservationExpiredException`, `NotListingOwnerException`, ...) are mapped centrally to `ProblemDetail` with stable codes.
- Never leak stack traces, SQL, or internal ids in responses; log them server-side with a correlation id.
- Never catch `Exception` just to keep going. Fail the transaction and surface a typed error.

## 11. Testing requirements

Tests are part of the deliverable.

- Flash-sale concurrency IT (Testcontainers MySQL): N threads buy M units; exactly M succeed; stock never goes negative.
- Reservation IT: a second buyer is rejected; the expiry job returns the item to `AVAILABLE`; an expired reservation cannot be paid.
- Approval workflow IT: `ROLE_USER` cannot approve; staff approve/reject works; an audit row is written; rejected or hidden listings disappear from the public catalog.
- Wallet IT: a failure mid-checkout rolls back every write; replaying an idempotency key does not double-charge; commission rounding is exact.
- SOAP IT (WireMock): request XML matches the contract; a partner timeout does not roll back the committed order; the tracking id is persisted.
- Prefer integration tests against real MySQL via Testcontainers; unit-test pure logic such as commission rounding and state transitions.
- Run `./mvnw verify` before declaring work done, and report the exact command and result.

## 12. Commands

```
./mvnw clean verify
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
./mvnw -Dtest=FlashSaleConcurrencyIT test
docker compose up -d mysql
```

## 13. Guardrails

- Do not commit, push, amend, or create branches unless the user explicitly asks.
- Do not edit or delete Flyway migrations that may already be applied; add a new migration instead.
- Do not let schema evolve through `ddl-auto`, `data.sql`, or manual database edits.
- Do not weaken or bypass security to make a feature work in development.
- Do not call external systems inside a database transaction.
- Do not use `float`/`double` for money or naive local-time timestamps.
- Do not put business logic in controllers, entities, or aspects.
- Do not log secrets, tokens, password hashes, or full customer PII.
- Do not fix unrelated code while implementing a feature; mention it in the summary instead.
- Do not silently change the REST contract; update OpenAPI annotations in the same change.

## 14. Definition of done (per feature)

- Flyway migration added if the schema changed, and it applies cleanly on a fresh database.
- Endpoints secured with the correct `@PreAuthorize` and documented in springdoc.
- Concurrency and transaction guarantees covered by tests.
- Audit entries produced for every status transition.
- `./mvnw verify` passes; the summary states the command run and any assumptions made.
