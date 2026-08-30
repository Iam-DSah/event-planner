# Engineering Decisions

Event Planning Application. This document records the engineering decisions
behind the implementation: what was decided, why, which alternatives were
considered, and what each choice costs. It is written to be read alongside the
source, and every measurement quoted in it was produced by running the system
rather than by estimating.

Each decision follows the same shape: the problem, the decision, the reasoning,
the alternatives rejected, and the trade-off accepted. Where a claim could be
settled by measurement, the measurement and its conditions are given.

The `README.md` covers setup, the API surface and a summary of these decisions.
This document is the detailed version. Appendix A lists what was executed to
verify the statements made here.

---

## Contents

| Section | Subject |
|---|---|
| 1 | System overview |
| 2 | Project structure |
| 3 | Database schema |
| 4 | Indexing and query performance |
| 5 | The HTTP error contract |
| 6 | Authentication |
| 7 | Authorization and visibility |
| 8 | Search |
| 9 | Transactions and concurrency |
| 10 | Web client architecture |
| 11 | Validation |
| 12 | Testing and verification |
| 13 | Assumptions |
| 14 | Known limitations |
| 15 | Scope |
| Appendix A | Verification record |

---

## 1. System overview

| Layer | Choice |
|---|---|
| API | Node 20 or later, Express 5, TypeScript, Knex query builder |
| Database | MySQL 8.4 in Docker, four Knex migrations, no ORM |
| Web client | React 19, React Router 7, Vite 7, Tailwind CSS 4 |
| Shared | Zod schemas imported by both the API and the web client |
| Auth | argon2id password hashing, JWT access cookie, rotating refresh tokens |

The repository is an npm workspaces monorepo containing three packages:
`apps/api`, `apps/web` and `packages/shared`. All SQL is written through Knex's
query builder; no ORM is used, so every query in the application is visible as
SQL rather than generated from model metadata.

---

## 2. Project structure

### 2.1 A monorepo with one shared validation package

**Problem.** The requirements call for validation on both the client and the
server. Implemented twice, the two copies drift, and the drift is discovered in
production rather than at build time.

**Decision.** A single repository with three workspaces. `packages/shared`
contains the Zod schemas and is imported by both sides, so each rule is defined
exactly once.

The payoff is concrete rather than theoretical. The events list page parses its
own query string with `eventListQuerySchema`, the same schema the API validates
the request against, so four rules cross the boundary and cannot diverge:
numeric coercion, default values, the maximum offset, and the case-insensitive
tag de-duplication written for the database's collation. A malformed page
parameter is refused in the browser with a field-level message and zero network
requests, which the browser harness asserts as a request count of zero rather
than as "an error appeared".

**Alternatives.** Two independent repositories were rejected because they make
duplication structural. Publishing the shared package to a registry was rejected
as version management with no consumer outside this repository.

**Trade-off accepted.** Dependency hoisting. npm installs one copy of a
dependency at the repository root and symlinks each workspace by its package
name. If two workspaces ever require different major versions of one library,
npm installs both, and the resulting failure appears at runtime while type
checking and building continue to pass. The current tree was checked for this:
`react`, `vite`, `tailwindcss`, `zod`, `express` and `knex` each resolve to
exactly one installed copy.

### 2.2 The shared package is consumed as TypeScript source

`packages/shared` exposes `"exports": { ".": "./src/index.ts" }`, so consumers
import the TypeScript source directly and there is no build step for the shared
package.

Both consumers already transpile TypeScript (`tsx` for the API, Vite for the web
client), so a build would add an artefact that can go stale without any signal.
The constraint this creates is recorded here because it is easy to violate
later: if the API ever gains a compiled production build, that export must point
at compiled output instead.

### 2.3 Four layers, and what each layer is forbidden to know

```
routes -> controllers -> services -> repositories
```

Controllers handle HTTP: they parse and validate input, then call a service and
serialise its result. Services hold the rules, including every authorisation
decision. Repositories hold all SQL.

The rule that makes this worth having is the prohibition: nothing below the
controller may reference a request, a response or a status code. An
authorisation rule expressed as a service function can be read and called
without an HTTP layer present. The same rule expressed as a status code inside a
route handler, or as an extra condition inside a SQL string, cannot be examined
independently of the transport that carries it.

---

## 3. Database schema

Five tables, plus the migration bookkeeping Knex maintains: `users`, `events`,
`tags`, the `event_tags` join table, and `refresh_tokens`. The schema is in third
normal form.

### 3.1 Tags are rows, not a delimited column

A tag name is stored once in `tags` and referenced from `event_tags` by id. The
alternative, a comma-separated string on `events`, makes filtering by tag a
substring scan that no index can serve, and it makes renaming a tag a rewrite of
every row that mentions it. With the join table, filtering by tag is an indexed
lookup, and `idx_event_tags_tag_id` exists specifically so that the reverse
direction (find the events carrying this tag) does not scan.

### 3.2 Event times are stored as UTC instants; the timezone column is for display

`events.starts_at` and `events.ends_at` hold UTC instants. `events.timezone`
holds an IANA zone name (for example `Asia/Kathmandu`) that describes where the
event happens, and it exists only so that the instant can be rendered in the
venue's local reading.

**The rule this creates.** `timezone` must never appear in a `WHERE` clause.
Comparing local times means wrapping the stored column in a function, as in
`WHERE CONVERT_TZ(starts_at, timezone, 'UTC') > UTC_TIMESTAMP()`, and a column
wrapped in a function cannot be served by an index on that column: the index is
sorted by `starts_at`, while the comparison is against a value computed per row.

Measured on this schema, with `EXPLAIN` confirming the plan in each case:

| Table size | UTC instant, indexed | Local time via `CONVERT_TZ` |
|---|---|---|
| 10,000 rows | 3.7 ms | 2.4 ms (faster at this size) |
| 510,000 rows | 32 ms | 166 ms (5 times slower) |

At 510,000 rows the indexed version reports `type: range, key: idx_starts_at,
Using index`; the `CONVERT_TZ` version reports `type: ALL, key: NULL`, a full
table scan. Fifty-one times more data made the indexed version roughly nine
times slower and the scanning version roughly seventy times slower. The first
scales with the size of the result, the second with the size of the table. At a
demonstration dataset of a few dozen events neither is measurable, which is
precisely why the decision was made against a seeded table: schema is chosen for
what it must survive, and it is the most expensive thing to change later.

**Consequence for the product.** "Upcoming" means upcoming in UTC for every
viewer. An event at 09:00 in Kathmandu and one at 09:00 in London are ordered by
the instants at which they occur, not by their local clock readings, which is
the ordering a shared list requires.

**Driver configuration.** mysql2 is pinned to `timezone: 'Z'` in `knexfile.ts`.
Without it the driver applies the host machine's offset when writing and reading
`DATETIME` values, which shifts every timestamp by an amount that depends on
where the server runs.

**Trade-off accepted.** If a jurisdiction changes its daylight-saving rules
after an event is created, the stored instant no longer corresponds to the local
wall time originally intended. Production calendar systems recompute affected
events when the timezone database is updated. This application does not, and the
limitation is recorded in section 14.

### 3.3 Foreign key behaviour states the intent

| Relationship | Behaviour | Reason |
|---|---|---|
| `events.creator_id` to `users.id` | `ON DELETE RESTRICT` | Deleting a user who owns events is a decision about other people's data, not a cascade to perform silently |
| `event_tags.event_id`, `event_tags.tag_id` | `ON DELETE CASCADE` | A join row has no meaning once either side is gone |
| `refresh_tokens.user_id` | `ON DELETE CASCADE` | A session has no meaning without its user |

`RESTRICT` on the event creator is the load-bearing one. It converts "delete
this account" from an operation that quietly removes other users' visible
content into an error that forces the question to be answered explicitly. The
consequence for maintenance work is that events must be deleted before their
creator; the automated suite orders its cleanup accordingly.

### 3.4 Tag identity: trimmed in code, cased by collation

`tags.name` is `UNIQUE` under `utf8mb4_0900_ai_ci`, which is accent-insensitive
and case-insensitive, so `Birthday` and `birthday` are one tag with no
application code involved.

That collation is also NO PAD, meaning trailing spaces are significant, so
`"Birthday "` would pass the unique index as a second tag. Tag names are
therefore trimmed in application code before they reach the database. The
division is deliberate: case folding is a property of the data and belongs to
the collation, whitespace normalisation is a property of the input and belongs
to the code that accepts it.

### 3.5 Row timestamps are maintained by the database

`created_at` and `updated_at` are `DATETIME(3)` columns with
`DEFAULT CURRENT_TIMESTAMP(3)` and, for `updated_at`,
`ON UPDATE CURRENT_TIMESTAMP(3)`. The application never sets them.

A timestamp set in application code is correct only while every write path
remembers to set it, and the first migration, backfill or manual correction that
forgets leaves a row whose `updated_at` is a lie. The database applies the rule
to every write by construction.

One case needs application help. When a request changes only an event's tags,
the `events` row itself is not updated, so MySQL has nothing to touch and
`updated_at` would not move even though the event visibly changed. The service
issues an explicit touch in that path, then re-reads the row so the response
carries the timestamp that was actually stored rather than the one read before
the touch.

### 3.6 Event times are stored to whole-second precision

`starts_at` and `ends_at` are `DATETIME`, which has no fractional seconds, while
`created_at` and `updated_at` are `DATETIME(3)`. MySQL rounds on write, so
`10:00:00.500` is stored as `10:00:01` and `10:00:00.100` as `10:00:00`.

Two instants less than a second apart can therefore land on the same stored
second. Before this was addressed, the application compared incoming values at
millisecond precision, concluded that the end time was after the start time, and
the `chk_events_ends_at` CHECK constraint then rejected the row, producing a
`500` from a request that was really a validation failure.

**Decision.** One exported helper, `toStoredSecond`, is used at all three
comparison sites: the create schema, the update schema and the service check
against the already-stored start time. Comparisons now happen at exactly the
precision the column keeps, so the rule the application enforces and the rule the
constraint enforces are the same rule.

**Alternatives.** Migrating the columns to `DATETIME(3)` was rejected as a schema
change to serve a case the interface cannot produce, since the browser's
`datetime-local` control is minute-precision. Catching the constraint violation
in the repository was rejected because it treats the symptom at the last layer
and teaches the application its own rules from the database. Truncating incoming
instants was rejected because it silently moves the organiser's time.

**Trade-off accepted.** An event window shorter than one second is rejected
rather than stored. That is the correct answer for a column that cannot
represent one. The database constraint remains as the guard of last resort, and
the principle is that a constraint firing is evidence of a validation gap, not a
mechanism for answering the user.

---

## 4. Indexing and query performance

### 4.1 Indexes are added against named queries

Every index costs write throughput and storage, so each one in this schema
traces to a query the application actually issues. Speculative indexes were
rejected on two grounds: they charge every insert for a query nobody makes, and
they make `EXPLAIN` output harder to read when diagnosing the queries that do
exist.

The current set on `events`:

| Index | Serves |
|---|---|
| `idx_events_visibility_starts_at` | public listings filtered by visibility and ordered by start time |
| `idx_events_creator_starts_at` | a creator's own events in date order |
| `idx_events_starts_at` | the signed-in listing query, which is a disjunction (section 4.2) |
| `idx_events_created_at` | sorting by creation time |
| `ft_events_search` | full-text search over title, description and location |

`idx_event_tags_tag_id` exists on the join table because its primary key is
`(event_id, tag_id)` and the leftmost-prefix rule means that key cannot serve a
lookup by tag alone.

### 4.2 The visibility disjunction, and why a plain index beat the rewrites

The signed-in listing query is a disjunction across two columns:

```sql
WHERE (visibility = 'public' OR creator_id = ?) AND starts_at > ?
ORDER BY starts_at, id
```

No B-tree can seek across that, because there is no single sorted range
containing both sets, so neither composite index applies. Measured on 200,005
events (190,000 public, 10,000 private, 95,784 matching the filter), MySQL
8.4.11, with `ANALYZE TABLE` run before each variant:

| Variant | First page | Plan |
|---|---|---|
| composite indexes only | 65.9 ms | `type: ALL`, `key: NULL`, full scan and filesort |
| `INDEX_MERGE` optimiser hint | 71.3 ms | hint declined, identical scan |
| `UNION` of two branches | 1.37 ms | two index range scans, materialised |
| `UNION ALL`, branches disjoint | 0.33 ms | same, one branch covering |
| standalone `starts_at` index | **0.17 ms** | index range scan already in `ORDER BY` order, no sort node |

**Why the index wins.** With `starts_at` indexed, MySQL walks the index in the
order the query already wants, evaluates the disjunction as a row filter, and
stops once the `LIMIT` is satisfied. The sort disappears entirely, and that is
the whole difference.

**Why the rewrite lost even though it is fast.** The `UNION` form is correct and
also quick, but it is twice as slow and it forces each branch to fetch
`offset + limit` rows before merging, which pushes pagination arithmetic into
the SQL. More code and more coupling for less speed is not a trade-off.

**On the option that never materialised.** Index merge was a candidate on paper.
The optimiser declined it here even when hinted explicitly, which is worth
stating plainly: an optimisation the planner cannot be made to choose is not a
design that can be relied on.

**Assumption this rests on.** The standalone index wins because roughly half of
all rows pass the disjunction in this dataset, so twenty matching rows appear
almost immediately. On a private-heavy dataset the same scan would read much
further before filling a page, and the `UNION` rewrite would become
competitive. The choice is conditional on the data keeping roughly this shape.

### 4.3 Sorting, and one option removed rather than indexed

| Sort | Without an index | With an index |
|---|---|---|
| `createdAt desc` | 74.1 ms (scan and sort) | 0.23 ms (reverse index scan) |
| `title asc` | 78.3 ms (scan and sort) | not measured; the option was removed |

Sorting by creation time is kept and indexed, because "newest first" is a real
browsing mode. Sorting by title was removed rather than supported, because
alphabetising events is not a stated requirement and removing an option is
cheaper than carrying a `VARCHAR(200)` index to serve it.

### 4.4 The exact total is the expensive half of pagination

| `COUNT(*)` variant | Time |
|---|---|
| composite indexes only | 70 ms (table scan) |
| with the `starts_at` index | 52 ms (still a table scan) |
| `UNION ALL` of two counts | 31.2 ms |

The index does not rescue the count, because counting 95,784 matching rows means
visiting 95,784 rows however they are reached. So on that dataset the page costs
0.17 ms and its total costs 52 ms.

That is the standing price of a page-numbered interface, and it is paid on every
listing request. Two ways out were rejected. Building the count from a separate
`UNION ALL` shape saves roughly 20 ms but breaks the rule that the rows and the
count come from one `WHERE` construction (section 7.3); a pager that disagrees
with its list is worse than a pager that is slow. Replacing the total with a
`hasMore` flag is cheaper still, but the interface is page-numbered and needs
the total.

### 4.5 Pagination depth is capped by offset, not by page number

The request schema rejects any request where `(page - 1) * limit` exceeds
100,000.

Capping the page number would have bounded nothing: page 10,000 is offset 9,999
at `limit=1` and offset 999,900 at `limit=100`, a hundredfold difference in rows
scanned and discarded. Bounding the offset is a single check that holds at every
limit.

The cost of offset pagination is inherent: the database cannot skip rows it has
not examined, so the work grows with the offset rather than with the page size.
Keyset pagination on `(starts_at, id)` removes that cost and is the upgrade path
if deep result sets ever matter; it was not built because it cannot express
"page 3 of 47", which the interface shows.

### 4.6 Tag filtering uses `EXISTS`, and stacked filters get cheaper

Each requested tag becomes a correlated `EXISTS` subquery, so multiple tags are
`AND`ed and an event must carry all of them.

Measured on the same seeded dataset over 6,897 tag links: one tag costs 16.1 ms
and two tags cost 11.4 ms. The optimiser drives from `idx_event_tags_tag_id` and
turns the second `EXISTS` into a covering primary-key lookup that discards rows
before the `events` table is touched, so adding a filter narrows the work rather
than adding to it. An unknown tag name short-circuits and costs nothing
measurable.

---

## 5. The HTTP error contract

### 5.1 Domain errors become status codes at exactly one edge

Services throw typed domain errors that carry a machine-readable `code` and a
message written for a client. A single Express error handler owns the only table
mapping error type to HTTP status. Nothing below the controller references HTTP.

`NotFoundError`, `ForbiddenError`, `UnauthorizedError` and
`EmailAlreadyRegisteredError` are the domain vocabulary; 404, 403, 401 and 409
are the transport vocabulary; the handler is the only place the two meet.

Errors are matched with `instanceof`, never by comparing constructors.
Constructor identity ignores the prototype chain, so the first subclass anyone
introduces would silently fall through to the generic branch and a 404 would
become a 500.

### 5.2 The response envelope

Every error response has the same shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Event not found" } }
```

Validation failures carry a third key, because a code and a message cannot tell
a form which input to mark:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "fields": { "title": ["Title is required"] } } }
```

The web client branches on `code` and never on `message`, so message wording can
change without breaking behaviour. `ROUTE_NOT_FOUND` (no such URL) is
deliberately distinct from `NOT_FOUND` (the handler ran and the resource does not
exist), because the two mean different things to a client and to an operator
reading logs.

### 5.3 The handler's branches, in order

The order is part of the contract; reordering changes behaviour silently.

| Branch | Matches | Result |
|---|---|---|
| 1 | mapped domain errors | the table's status and code, the error's own message |
| 2 | library errors with `expose === true` and a 4xx `status` | that status, with a code and message from a list the application owns |
| 3 | `UnauthorizedError` | 401, forwarding the error's own code |
| 4 | `ZodError` | 400 `VALIDATION_ERROR` with a per-field map |
| 5 | `EventValidationError` | 400 `VALIDATION_ERROR` for a rule that needs the stored row |
| 6 | anything else | 500, generic body, full detail to the log only |

Three points of detail are worth recording, because each was a defect before it
was a rule.

**`UnauthorizedError` stays out of the mapping table.** Every other domain error
maps to exactly one code, which is what lets the table own the code. This one
owns a union of `UNAUTHORIZED` and `TOKEN_EXPIRED`, and the refresh flow branches
on the difference, so branch 3 must forward the error's own code rather than
substitute a constant.

**Branch 2 exists because library errors carry their own status.** The body
parser's `PayloadTooLargeError` has `status: 413` and `expose: true`, the
convention meaning "safe to show the client". Without this branch, a request body
over the 100 kB limit was reported as a 500: a client error told as a server
error, and logged with a stack as though unexpected. The branch honours the
status, but takes the code and message from a list the application controls, so
a library's wording never becomes the API's contract. An exposed 4xx that is not
in that list returns its real status with a generic body and a warning line
naming the status, name and type, because "I cannot safely describe this" must
not degrade into "the server crashed".

Two properties of that branch were established by running it rather than by
reading documentation: `expose` and `status` live on the error's prototype, so an
own-property check compiles, type checks and never fires; and a list covering
only 400 and 413 still produced a 500 for an `expose: true` 415 raised by an
unsupported `Content-Encoding`, which is why the generic 4xx fallback exists.

**Unexpected errors return a generic 500.** A raw driver message names tables,
columns and constraint names; a stack trace names file paths and dependency
versions. Express's own default handler renders stack traces into the response
outside production, so not leaking this is something the application installs
rather than something it inherits.

### 5.4 Library errors are translated where they occur, never at the edge

Branch 1 forwards the error's own message, which is safe only because everything
reaching it is an error this application wrote. The duplicate-key case shows why
that boundary matters. The driver's error reads:

```
insert into `users` (`email`, `name`, `password_hash`) values
('user@example.com', 'B', 'y') - Duplicate entry
'user@example.com' for key 'users.users_email_unique'
```

Mapping that error at the edge would ship the statement, the submitted address
and the index name to the client. It is caught in the repository where the insert
runs and re-thrown as `EmailAlreadyRegisteredError`, whose message the
application controls. The driver's error class is a plain `Error`, so it is
matched on `code` and `errno` rather than with `instanceof`.

### 5.5 The health endpoint answers outside the error contract

`GET /api/v1/health` runs a real query against the database and returns 200 when
it succeeds and 503 when it does not. It does not delegate to the error handler,
because "the service is running and its dependency is not" is a different
statement from "the service crashed", and an orchestrator acting on the response
needs to tell them apart.

Both connection phases are bounded in `knexfile.ts`: `connectTimeout` at 5
seconds against a mysql2 default of 10, and `acquireConnectionTimeout` at 5
seconds against a Knex default of 60. A timeout attached to a query covers
neither, because it only begins once a connection exists. Without both bounds, a wedged
database left the health check hanging for about ten seconds, where the
two-second query timeout implied two.

---

## 6. Authentication

### 6.1 Password hashing: argon2id with explicit parameters

Passwords are hashed with argon2id at 19,456 KiB of memory, 2 iterations and 1
lane, which is the OWASP baseline configuration. The parameters are passed
explicitly rather than left to library defaults. They currently match the
defaults, and they are still written out, because the parameters are the security
decision and a default that changes underneath the application changes that
decision without a commit.

argon2id is memory-hard, which is what makes parallel cracking on commodity GPUs
expensive; bcrypt's cost parameter constrains time but not memory.

bcrypt also ignores every byte past the 72nd. That was demonstrated rather than
cited: a 106-character password was hashed, and a different 106-character
password sharing only its first 72 bytes verified as correct. argon2id rejects
it. The same check was run against this application's own hashing: a
100-character password was registered, and a login with a different 100-character
password sharing its first 72 bytes was refused with 401 while the correct
password succeeded.

### 6.2 The access token: a JWT in an httpOnly cookie, 15 minutes, stateless

The access token is an HS256 JWT delivered in a cookie marked `HttpOnly`,
`Secure` and `SameSite=Lax`, valid for 15 minutes and verified without a database
read.

**Why a cookie rather than `localStorage`.** Anything in `localStorage` is
readable by any script running on the page, so a single cross-site scripting
flaw yields the whole session. An `HttpOnly` cookie cannot be read by script at
all. The cost is exposure to cross-site request forgery, which `SameSite=Lax`
addresses by withholding the cookie from cross-site requests.

**Why the payload carries only `sub`.** A JWT is signed, not encrypted, so every
claim is readable by whoever holds the token. Beyond disclosure, every claim is a
copy of database state frozen at the moment of issue: a role embedded in a
15-minute token is a 15-minute window during which a revoked administrator is
still an administrator.

**Hardening that is not optional.** The verifying call pins
`algorithms: ['HS256']`, because the algorithm header travels with the token and
is therefore attacker-controlled. `jwt.decode` appears nowhere in the codebase:
it performs no verification, so calling it on an authentication path is a
complete bypass that reads as correct during review. `JWT_SECRET` is validated at
import for presence and a 32-character minimum, so the process refuses to start
misconfigured rather than signing tokens with a weak key.

**Verified behaviour worth recording.** The web client on port 5173 and the API
on port 3000 are same-site, because a site is defined by registrable domain and
scheme and does not include the port. `SameSite=Lax` therefore works in local
development with no `SameSite=None` and no HTTPS. Those two origins are still
cross-origin, so CORS with an explicit origin and credentials remains required.
The two mechanisms are frequently conflated and are not the same.

**Trade-off accepted.** Verification is stateless, so a user deleted or demoted
mid-session keeps access until the access token expires, at most 15 minutes.
Refresh tokens are stored server-side and are revocable immediately, which bounds
the exposure to that window.

### 6.3 Refresh tokens: opaque, hashed, rotated, grouped into families

```
access token    JWT, 15 minutes, stateless, subject only   Path=/
refresh token   opaque random, 30 days, a database row     Path=/api/v1/auth
```

A 15-minute absolute access token is only coherent with a refresh token behind
it; on its own it is a 15-minute hard logout. The word that matters is
*stateful*: statelessness is exactly what makes a token unrevocable, and a
refresh token is a row, so revocation is possible and logout means logout.

**Opaque, not a JWT.** The token is looked up in the database on every use, so a
signature would be verified *and* queried, buying nothing. It is 32 random bytes
in base64url: 256 bits, 43 characters, URL-safe, carrying no claims to leak. A
JWT here would imply the server can trust the token without a lookup, which is
the one thing it must not do. `crypto.randomUUID` is used for the family
identifier and would be wrong for the token itself, since a version 4 UUID
carries roughly 122 bits with fixed version and variant bits.

**SHA-256 at rest, not argon2, and no salt.** This is the inverse of the password
decision and follows from the same reasoning. Argon2's cost defeats guessing
attacks against low-entropy human input; a 256-bit random value has no such
weakness, so the work factor buys nothing while costing roughly 17 ms and 19 MiB
on an endpoint reachable without authentication. The hash is also the index key:
a per-row salt would make lookup impossible, turning a unique-index seek into a
scan that degrades as sessions accumulate. No constant-time comparison is needed
either, because the comparison happens in MySQL against an indexed hash of the
value the caller supplied, not against the secret.

**Rotation, reuse detection and families.** Every successful refresh issues a new
token and retires the old one, bounding how long a stolen token stays useful.
Rotation then produces a signal: a retired token being presented means replay or
a client defect, and since the two are indistinguishable, compromise is assumed
and every token descended from that login is revoked.

Retirement is an atomic compare-and-set rather than a read followed by a write:

```sql
UPDATE refresh_tokens SET used_at = ?, replaced_by_id = ?
WHERE id = ? AND used_at IS NULL
```

Verified under real parallelism: with 3 and with 8 simultaneous callers, exactly
one receives an affected-row count of 1. A read-then-write here would be a race,
and that race is what turns "the user opened three tabs" into "the user was
logged out for suspected theft".

**The grace window.** Concurrent refreshes are normal in a single-page
application, so a token used within the last 10 seconds is treated as a
concurrent refresh rather than as an attack. The obvious implementation, handing
back the successor the first request created, is impossible: only the successor's
hash is stored, and its plaintext went to the client that minted it. The grace
path therefore issues a new sibling in the same family. The assumption this
creates is stated in section 13: inside the window, N concurrent refreshes leave
N live tokens, bounded to 10 seconds, all in one family, all revoked together by
any later reuse or by logout. Measured: 6 concurrent rotations of one token
produced 6 successes and 6 distinct tokens with nobody logged out.

**Revocation must not run inside a transaction that later throws.** Reuse
detection has to revoke the family and reject the request. If the revocation runs
inside a transaction that then throws, the rollback undoes it: the attacker
receives an error and keeps a live family, and every test asserting 401 still
passes. Detection therefore happens before any transaction is opened, revocation
commits on the pool, and only then is the error thrown. Verified over HTTP: a
family with 2 live tokens, replaying a token used 60 seconds earlier, returns 401
and leaves 0 live tokens in the family.

**Uniform rejection.** Unknown, expired, revoked and reused tokens all answer
identically with `401 UNAUTHORIZED` and the same message. Four distinct messages
would tell whoever holds a stolen token whether it is still live, which is a
state oracle on a credential. The specific reason goes to the log.

**Cookie scoping.** The refresh cookie is scoped to `Path=/api/v1/auth`, so it is
not attached to event requests. That reduces its exposure, and it is why the
refresh endpoint lives under that prefix.

### 6.4 Registration: a clear 409, and a length-based password policy

A duplicate email returns `409 EMAIL_ALREADY_REGISTERED` with a message that says
so. That is an account-enumeration oracle, and it is a deliberate trade rather
than an oversight. The requirements ask for clear, user-friendly error messages,
and concealing existence properly means accepting the registration and sending an
email that says an account already exists, which requires mail infrastructure
outside this scope. Where enumeration is the stronger concern, the answer is an
email-verification flow together with rate-limited registration, not a vaguer
message.

**Duplicates are detected by the unique index, not by a prior `SELECT`.** A
select followed by an insert is two statements, and two concurrent registrations
of one address both pass the select; the constraint has to be handled regardless,
so the pre-check buys only a round trip. Verified: four simultaneous
registrations of one address returned one 201 and three 409, with no 500.

**Password policy follows NIST SP 800-63B.** Minimum 8 characters, maximum 128,
and no required character classes. Composition rules measurably reduce entropy by
pushing people toward predictable substitutions, while length is what actually
helps, so passphrases are accepted to 128 characters. The maximum exists to bound
hashing cost, not because the algorithm requires it, since argon2id does not
truncate. Verified: 7 characters is rejected with a field-level message, 8 and
128 are accepted, 129 is rejected, and none of the accepted values contained a
digit, a capital or a symbol.

Registration signs the user in: the 201 response sets both cookies, and
`/auth/me` answers 200 with them.

### 6.5 Login answers identically for an unknown email and a wrong password

Both cases return the same status and the same message. That alone is
insufficient, because an unknown email would return immediately while a wrong
password pays for a hash verification, and the difference is measurable with a
stopwatch regardless of how generic the wording is.

The unknown-email path therefore performs a discarded verification against a
dummy hash. Measured over 40 interleaved pairs:

| | unknown email | wrong password | gap |
|---|---|---|---|
| as implemented | 14.61 ms | 14.40 ms | 0.20 ms |
| dummy verification removed | 2.79 ms | 15.55 ms | 12.77 ms |

The dummy hash is computed at startup rather than hardcoded. argon2 reads its
cost parameters out of the hash string, so a stale literal would keep verifying at
the old cost after the parameters were raised, silently reopening the gap while
every test continued to pass.

The login schema validates shape rather than policy: a non-empty password, not an
8-character one. Rejecting a short guess with 400 where a real attempt receives
401 would replace a timing oracle with a status-code oracle.

### 6.6 Cookie attributes are one shared constant

Registration, login, refresh and logout all build their cookies from one
constant. `clearCookie` only removes a cookie whose attributes match those it was
set with, so a mismatch produces a cheerful 204 while the cookie remains in the
browser. Logout must exist as a server endpoint for the same structural reason
the cookie is safe: the client cannot clear what it cannot read.

`Secure` is set unconditionally, including in development. Browsers accept
`Secure` cookies over `http://localhost`, so the development experience is
unaffected, and the default fails closed rather than open.

---

## 7. Authorization and visibility

### 7.1 The rule loads the row, decides, then writes

Ownership is enforced in the service by reading the event, comparing its creator
to the caller, and only then performing the write. It is deliberately not
expressed as an extra `AND creator_id = ?` on the `UPDATE`.

A `WHERE` clause that matches nothing cannot distinguish "this event is not
yours" from "this event does not exist", so it cannot produce the correct status
code, and it buries an authorisation decision inside a SQL string. Expressed as a
service function, the decision is one readable branch with three named outcomes,
and the automated suite asserts each of them through the API.

For `PATCH`, the read, the decision and the write share one transaction, so the
row cannot change between the check and the update. `DELETE` performs the same
guard and then issues a single delete statement; the join rows in `event_tags`
are removed by the cascade rather than by application code. A second delete of
the same event answers 404 exactly as a `GET` of it would, because both paths run
the same guard.

### 7.2 A private event that is not yours answers 404, never 403

| Case | `GET` | Mutation | What the interface shows |
|---|---|---|---|
| no such event | 404 | 404 | "does not exist, or you do not have access" |
| private, not yours | 404 | 404 | the same string, byte for byte |
| public, not yours | 200 | 403 | the full event, with no delete control |
| yours | 200 | allowed | the full event, with the delete control |

A 403 confirms that the resource exists, which is the fact its owner made it
private to conceal. The response body for a private event that is not yours is
byte-identical to the body for an event that never existed; differing by a single
word would still be an oracle for anyone enumerating identifiers. The automated
suite asserts identity of the two bodies rather than merely asserting that an
error occurred.

403 is reserved for mutating a *public* event you do not own, where existence is
not a secret and the honest answer is that the action is forbidden.

The interface mirrors this exactly. The natural, helpful wording, "this event is
private", would hand back in the browser precisely the existence the API spends a
branch concealing, so the detail page renders one string for both cases. The
delete control is hidden for events you do not own, but the protection is the
service guard rather than the absence of a button.

`pagination.total` excludes private rows belonging to other users for the same
reason: a count that moves when a private event is created leaks its creation.

### 7.3 One `WHERE` builder serves both the rows and the count

`applyEventListFilters` is the only place list filters are constructed, and both
`findEvents` and `countEvents` call it. Anything added to one query alone makes
the total disagree with the rows, with nothing raising an error.

This was verified by negative control rather than by inspection. Moving the
search predicate into the rows query only produced a page listing 3 events above
a pager reporting 4, and seven further assertions failed alongside it because the
visibility-scoped count was wrong too.

The visibility clause itself is grouped and unconditional:

```sql
WHERE (visibility = 'public' OR creator_id = ?)
```

Grouped, because an ungrouped `OR` in SQL swallows every `AND` beside it and
returns the entire table. Unconditional, because no later filter, including the
"only mine" filter, should be able to become the reason it was skipped.

---

## 8. Search

### 8.1 FULLTEXT rather than `LIKE`, decided by measurement

`?q=` searches title, description and location through a `FULLTEXT` index in
BOOLEAN mode. Measured on 202,148 rows of realistic text, a page of 20, medians
of three runs:

| Page of 20 | rare term (10 matches) | common term (25,000 matches) |
|---|---|---|
| `LIKE '%term%'`, date order | 335 ms | 0.26 ms |
| `FULLTEXT`, date order | 0.10 ms | 66 ms |
| `FULLTEXT`, relevance order | not applicable | 4.2 ms |
| `FULLTEXT` and a tag filter, relevance order | 0.10 ms | 7.4 ms |
| `LIKE` and a tag filter, date order | 31.6 ms | 28.8 ms |

Three findings from that table shaped the decision.

`LIKE` is fast on a common term, which is the opposite of the usual advice about
leading wildcards. It walks the start-time index in sort order and stops at 20
matches: 81 rows examined for a common term, against 101,873 for a rare one. The
wildcard is not the problem; selectivity is.

The 66 ms figure for FULLTEXT in date order is the sort, not the match. The plan
carries a node that materialises all 25,000 hits before taking 20. Ordering by
relevance removes it and examines 48 rows.

The tag filter settles it. The real endpoint composes tag `EXISTS` filters, and
that join forces a sort node which destroys `LIKE`'s early exit, taking it from
0.26 ms to 28.8 ms. FULLTEXT wins in both regimes once tags are present, and tags
are a required filter.

The index is also the only one that has ever helped the pager's count, which
section 4.4 established is otherwise always a table scan: 210 ms to 0.07 ms on a
rare term, and 234 ms to 63 ms on a common one.

**Write cost, measured against the pattern the application actually has.** A
bulk insert of 20,000 rows costs roughly three times more with the index present.
Five hundred single-row inserts, which is what the API performs, cost 4.10 ms per
row without the index and 4.15 ms with it, a difference below measurement noise.

**Capabilities given up.** FULLTEXT matches tokens rather than substrings, so
there is no equivalent of an internal-substring search, no fuzzy matching and no
"did you mean". MySQL's default stopword list excludes 36 common words.

### 8.2 BOOLEAN mode, every term required, and sanitised input

Terms are combined as required terms with a trailing wildcard, so `jazz workshop`
becomes `+jazz* +workshop*`. Requiring every term is chosen because the search box
sits inside the filter form, and filters narrow: adding a word must reduce the
result set, not expand it. Making terms optional was measured as well and returns
414 rows tied at one relevance score for a query whose discriminating token
matches nothing, which trades "no results" for "many results in arbitrary order".

The trailing wildcard is mandatory rather than cosmetic, because FULLTEXT indexes
whole tokens: a prefix matches nothing without it. It expands to indexed tokens
sharing the prefix, so it does not make short tokens searchable; that is a
separate problem, addressed in section 8.3.

Input is sanitised before it reaches MySQL. The characters `+ - ~ < > ( ) " * @`
are BOOLEAN-mode operators, so an unsanitised hyphen turns a search for a
hyphenated name into a negation that returns the complement of what was asked.
They are replaced with spaces rather than deleted: deleting them turns
`Yoga@Home` into the single unmatchable token `YogaHome`, while replacement
yields two searchable words.

### 8.3 Short terms fall back to `LIKE`, per token

InnoDB does not index tokens shorter than `innodb_ft_min_token_size`, which
defaults to 3. A required term that cannot be indexed matches nothing, so a
search for a two-letter word returned an empty list while a matching event was
visible on screen.

The query planner therefore splits the input by what the index can answer. Tokens
of three characters or more are matched with `MATCH`; shorter tokens are matched
with `LIKE` against the same three columns, one grouped `OR` per token, `AND`ed
together. The semantics are identical on both paths (every term required, order
irrelevant), so which path a query takes is invisible in its results.

| Query | Rows |
|---|---|
| `q=AI` through the application | 1 |
| `MATCH ... AGAINST('+AI*')` alone | 0 |
| `MATCH ... AGAINST('+Conference*')`, control | 1 |

Switching to `LIKE` wholesale was rejected: it abandons the index and makes the
query cost depend on term selectivity, as section 8.1 shows.

`LIKE` patterns escape `%` and `_` with an explicit `ESCAPE '!'` clause rather
than the backslash default, which would have to survive both TypeScript's string
literal and MySQL's, and whose apparently correct form is a syntax error.

**One guard that is easy to lose.** A query consisting only of punctuation
produces no indexable tokens and no short tokens, which means no predicate at
all, which would return the entire table to someone who searched. An explicit
`1 = 0` covers that case. It was free before the plan split, because matching
against an empty string returns nothing, and it stopped being free the moment the
split was introduced. A negative control confirmed the failure mode before the
guard was added.

### 8.4 Relevance ordering, and the tiebreaker that is not free

Supplying `q` defaults the sort to relevance, since searching implies wanting the
best matches first, and section 8.1 shows that date-ordering a full-text result
is where the cost goes. Asking for `sort=relevance` without `q` is a 400 rather
than a silent fallback, because there is nothing to rank.

The same `MATCH` expression is written once as a constant and used for both the
`WHERE` and the `ORDER BY`. MySQL reuses a single full-text scan only when the
two expressions are identical, and a shared constant is also the only way to
guarantee they cannot drift apart later.

Ordering carries a secondary key on `id`, and it costs measurably:

| Ordering | Plan | Time |
|---|---|---|
| relevance, then `id` | `Using filesort` | 3.93 ms |
| relevance only | sort and limit pushed into the full-text scan | 1.78 ms |

The tiebreaker is kept regardless. Relevance scores tie constantly, MySQL
guarantees no order among ties, and offset pagination over an unstable sort
silently repeats and skips rows between pages. A user sees duplicated rows; they
do not see two milliseconds. The fix that removes the trade-off is keyset
pagination, which is the same conclusion section 4.5 reached and is not built for
the same reason.

---

## 9. Transactions and concurrency

### 9.1 An event and its tags are written in one transaction

Creating or updating an event with tags performs several statements: insert or
update the event, find or create each tag, and replace the join rows. They run in
one transaction, so an event never exists with half its tags attached.

Tags are found-or-created rather than assumed absent, because tag names are
shared across users and a concurrent request may create the same name first. The
unique index on `tags.name` is the authority, exactly as it is for user emails
(section 5.4).

### 9.2 Deadlock retry, bounded and jittered

Concurrent transactions that touch the same tag rows in different orders can
deadlock, and MySQL resolves a deadlock by rolling one transaction back with
`ER_LOCK_DEADLOCK`. That is an expected outcome under concurrency rather than a
defect, so the service retries the whole transaction up to three times, with a
randomised backoff that grows with the attempt number.

The randomisation is the part that matters: two transactions retried immediately
and simultaneously can deadlock again in the same pattern, and separating them in
time is what breaks the cycle. Errors that are not deadlocks are rethrown
immediately rather than retried, because retrying a deterministic failure only
delays it.

### 9.3 Revocation commits outside the transaction it protects

Recorded in section 6.3, and repeated here because it is a transaction-scope
decision rather than an authentication one: work whose purpose is to record that
a request must fail cannot run inside a transaction that the failure will roll
back.

---

## 10. Web client architecture

### 10.1 Session state has three values, not two

Authentication state is "loading", "signed in as this user", or "signed out".
With only a user object or `null`, `null` means both "the session check has not
finished" and "there is no session", so a signed-in visitor is redirected to the
login page on every page refresh while the check is still in flight.

The route guards therefore render nothing and return while loading, rather than
redirecting. This applies in both directions: the guard that keeps signed-out
visitors away from the application and the guard that keeps signed-in visitors
away from the login page follow the same rule, or a signed-out visitor is bounced
off the login page for as long as the session check takes.

### 10.2 A single-flight refresh, retried exactly once

A 401 from any request triggers one refresh attempt, and the original request is
then retried once. Concurrent requests share one in-flight refresh promise, which
is cleared in a `finally` block: clearing it only on success would cache a
rejected promise and leave every later request awaiting a permanent failure.
React's StrictMode double-mounting exercises this path on every page load.

The retry is capped at one attempt. A 401 arriving after a refresh has already
succeeded must not trigger another refresh, or a deleted user whose refresh token
still rotates loops indefinitely.

The refresh branches on the HTTP status rather than on the `TOKEN_EXPIRED` code.
The access cookie's lifetime and the token's own expiry are both 900 seconds and
are set in the same instant, so in a browser the cookie is absent rather than
expired, and the API sees no credential at all. `TOKEN_EXPIRED` is reachable only
by a client that presents a stored token directly.

The callback that ends the session locally fires only after a refresh has failed,
because a 401 that a refresh then repairs is not a logout. Logout itself is a
deliberate transition the provider owns.

### 10.3 Routing is a function of authentication state

No page component navigates. The guards own every redirect, and the root route
owns the default destination.

This is a correctness decision rather than a stylistic one. When a page called
`navigate()` after a successful sign-in while a guard also reacted to the same
state change, both ran, and the guard won, discarding the deep link the visitor
originally arrived with. Predicting which of two navigations wins is guessing;
removing one of them is a design. The one deliberate exception is deleting an
event, where the resource named by the URL has ceased to exist. That is not an
authentication transition and no guard can observe it, so the page navigates and
replaces the history entry, ensuring the back button does not return to a URL
that now answers 404.

### 10.4 The list page's state is the URL

Filters, search text, sort, order and page number live in the query string and
nowhere else. There is no component state mirroring them and no effect
synchronising the two.

A mirror creates two stores for one fact, and the browser's back button writes to
only one of them. Keeping the URL authoritative also makes a filtered list
shareable and reload-safe for free.

Three details follow from that decision:

The query string is parsed with `getAll` for repeated keys. Collapsing the query
string into an object keeps only the last occurrence of a repeated key, so a
request filtered by two tags would filter by one of them and return a healthy 200
with the wrong rows.

The parse is memoised on the query string, not on the parameters object, because
a fresh object identity on every render re-triggers the fetch effect on every
render.

The filter form is uncontrolled and keyed on the query string. The text a visitor
is typing and the filter that is currently applied are different facts, and
nothing should synchronise them; keying the form on the query string re-seeds it
when navigation changes the applied filter, including via the back button.
Applying a filter also deletes the page parameter, or filtering while on page 5
lands on page 5 of a two-page result, which reads as "no matches".

### 10.5 One component formats timestamps, and it shows both readings

`EventTime` is the only place in the web client where a timestamp is turned into
text. It always renders the event's venue reading, and it adds the viewer's own
local reading whenever the two differ.

Whether they differ is decided by comparing the rendered strings, never the zone
names. `Asia/Katmandu` and `Asia/Kathmandu` are one zone with two spellings, so
comparing names tells a viewer in Kathmandu the same time twice.

The viewer's reading always carries its own date, because a time difference large
enough to matter is frequently also a date difference.

The list view renders this as a column through the same component under a stacked
variant, rather than formatting dates in the list page. The rule for "do these
readings differ" would otherwise exist in two places and disagree the first time
either changed. That variant makes one deliberate departure from the viewer's
locale: it pins a 24-hour cycle, because a locale that renders `7:00 PM` beside
`11:45 AM` gives every row a different width and the column edge wobbles down the
page. Tabular figures fix digit width but cannot fix a suffix that is present on
some rows and absent on others. The detail page and the create form's preview are
unaffected and remain in the viewer's locale, because neither is a column.

### 10.6 Wall time to instant takes two passes

Converting a typed wall-clock time in a chosen zone into a UTC instant is
circular: the offset to apply depends on the instant, and the instant depends on
the offset. The first pass breaks the circle with a guess and the second corrects
it.

Measured across ten conversions spanning daylight-saving boundaries, the one-pass
version was wrong on one and the two-pass version on none. The failing case is a
time shortly after a spring-forward transition, where the guessed offset is the
pre-transition one and the result lands an hour out.

The inverse conversion matters equally and is easy to forget: the edit form seeds
its fields from the instant converted back into the event's zone, not from an
ISO string truncated to minutes, because the latter is the UTC wall time and
saving an untouched form would move the event by the zone's offset.

The timezone picker does not trust the platform list alone. Chromium's list of
supported zones contains legacy aliases and no UTC entry at all, so the picker
folds in the event's own stored zone and always adds UTC. Without that, a
`<select>` whose value is absent from its options renders the first option
instead of blank, so the form would display a different zone from the one held in
state and stored in the database.

### 10.7 Styling: Tailwind CSS 4 with the theme declared in CSS

The interface uses Tailwind CSS 4 through its Vite plugin. There is no
`tailwind.config.js`: the palette, the two type families and the handful of
component classes are declared in `apps/web/src/styles.css` using `@theme` and
`@layer components`.

Tailwind version 4 reads the theme from the stylesheet, and every token declared
there generates its own utilities, so a colour has exactly one definition and
exactly one name, both in the file that uses them. A configuration file would
split that across two files for no gain.

**Alternatives.** Plain CSS with custom properties adds no dependency and was the
lighter option. CSS Modules is also dependency-free and Vite-native, but one file
per component buys scoping that six screens with no name collisions do not need. A component library was rejected because the markup already existed and was
already accessible; the gap was visual rather than structural.

**Cost, and the containment applied.** Two dependencies were added, both scoped
to the web workspace so the API and the shared package declare no dependency on
them. Because dependency duplication is the standing risk of a workspace layout
(section 2.1), the installed tree was checked rather than assumed: one copy of
`tailwindcss`, one of the Vite plugin, and still one each of React and Vite. The
failure mode worth knowing is that an unknown utility class produces no CSS and
no error, so a typo renders as inherited styling rather than as a build failure.

**Verified outcomes.** Every rendered text colour was measured against its actual
background, with the lowest ratio at 5.21:1 against a 4.5:1 requirement. No
horizontal overflow appears at either 390 px or 1280 px viewport width.

---

## 11. Validation

### 11.1 One schema per rule, imported by both sides

Every validation rule is a Zod schema in `packages/shared`, imported by the API
controller that validates the request and by the React component that validates
the form. The requirement is validation on both sides; the design goal is that
the two cannot disagree.

The API validates independently of the client in every case. Client-side
validation is a convenience that avoids a round trip and gives immediate
feedback; it is never the enforcement point, because a client is not a trust
boundary.

### 11.2 Messages are written for the person reading them

Zod's default messages describe the schema. They are accurate and unusable:
*"Too small: expected string to have >=1 characters"* tells a person filling in a
form nothing about what to do. Every check therefore carries an explicit message.

| Default | Written |
|---|---|
| Too small: expected string to have >=1 characters | Name is required |
| Invalid input: expected string, received undefined | Start date and time is required |
| Too big: expected array to have <=20 items | You can add up to 20 tags |
| Invalid ISO datetime | Enter a valid start date and time |

The messages live in the shared schema rather than in the React components,
because a message fixed in the schema reaches the API's validation branch and the
browser's parse from the same line. Fixing them in the components would recreate
the duplication that section 2.1 exists to prevent.

Check order within a field is part of the design, because the interface shows the
first issue for a field. A minimum-length check must precede a format check, or an
empty input reports "enter a valid email address" when the real problem is that
it is empty.

### 11.3 Bodies are strict; query strings are not

Request bodies reject unknown keys. An unexpected key in a JSON body is a client
defect worth reporting, and silently ignoring it hides a misspelled field name
that the sender believes is being saved.

Query strings deliberately do not reject unknown keys, because an unknown query
parameter is usually a campaign tag or a proxy's addition to a URL that a person
pasted, and refusing to render a page over `utm_source` is user-hostile.

Two consequences are worth recording. An unknown body key is reported against the
object rather than against a field, since no field owns it; the API reports it
under the key `_form`, which the interface renders as a form-level message. And a
client that serialises arrays as `tag[]=a` filters nothing and receives no error,
because Express 5's default query parser treats `tag[]` as a literal key name.

### 11.4 Configuration is validated at import, and the example must fail

`JWT_SECRET` is read through a helper that checks presence and a minimum length
of 32 characters, evaluated when the module is first imported, so a misconfigured
process refuses to start instead of signing tokens with a weak key. The minimum
follows RFC 7518, which requires a key of at least 256 bits for HS256.

`.env.example` ships a placeholder that is ten characters long, deliberately
below that floor. An earlier placeholder was 41 characters and therefore passed
validation, which meant that copying the example file and forgetting to generate
a key produced an application that started normally and signed every token with a
value published in the repository, with nothing in the logs to indicate it. The
placeholder now fails validation at startup:

```
JWT_SECRET=replace-me-with-32-plus-random-characters  ->  server starts
JWT_SECRET=replace-me                                 ->  JWT_SECRET must be at
                                                          least 32 characters long
```

Nothing in the application code changed. The safety came from making the default
state of a fresh checkout a loud failure rather than a silent one.

---

## 12. Testing and verification

### 12.1 The automated suite covers the rules that fail silently

`npm test` runs 13 tests in six areas with `node --test` through `tsx`. The API
exports its Express application without binding a port, so the suite starts its
own listener on an ephemeral port and needs no development server and no browser.

The scope is deliberate. The suite covers the rules where a wrong answer is
silent, meaning the caller still receives a healthy-looking response and nothing
appears broken:

| Area | What a regression looks like from outside |
|---|---|
| creator-only mutation | another user's edit succeeds with 200 |
| private events answer 404 | a 403 confirms the event exists |
| `pagination.total` | the list is right and the number above it is not |
| end time against the stored start time | a sub-second range trips a database constraint as a 500 |
| timezone round trip | every event moves silently by the host's UTC offset |
| search sanitising | a leading hyphen returns every row that does not match |

Failures that are loud, such as a crash, a 500 or a blank page, are found by
running the application once and do not need a test to notice them.

**Why `node --test` and not a framework.** The runner is built into Node, so
nothing is installed, and `tsx` is already a dependency that already transpiles
the source. Adding a framework on top of a suite this size would mean a
dependency, a configuration file and a transform pipeline to maintain.

### 12.2 Browser harnesses cover the flows a request-level test cannot

A set of scripts drives the running application through a real browser: 148
checks across ten scripts, all passing. They cover what request-level tests
cannot observe, including cookie attributes, guard behaviour during navigation,
and the interface's own handling of the visibility rules.

Two of them exist because of a specific failure. A fifteen-check browser suite
once passed while the application had no link at all to its own registration
page, because every check navigated directly to a URL. A suite driven by URLs
verifies that pages work; it cannot discover that a page is unreachable. One
harness therefore performs a single navigation for an entire run and clicks to
reach everything else, and another visits every route in both authentication
states and reports any screen with no outbound links.

### 12.3 The suite was checked by breaking the code

A passing suite proves that the tests pass, not that they would fail if the rules
were violated. Each rule was therefore deliberately broken in the source and the
suite confirmed to catch it. That exercise found two defective tests, which is
the reason it was done rather than trusting a green result.

The same technique was applied to the query layer: moving the search predicate
out of the shared filter builder produced a pager that disagreed with its list,
and the check caught it (section 7.3).

---

## 13. Assumptions

1. A user is identified by an email address. There are no usernames.
2. Access tokens are verified without a database read, so a user deleted or
   demoted mid-session retains access until the token expires, at most 15
   minutes. Refresh tokens are stored server-side and are revocable immediately.
3. Within the 10-second refresh grace window, concurrent refreshes leave several
   live refresh tokens in one family. They expire together, and any later reuse
   or logout revokes the family.
4. `Secure` is set on cookies unconditionally, including in development.
   Browsers accept `Secure` cookies over `http://localhost`, and failing closed
   is the safer default.
5. CORS permits exactly one origin and is enforced by the browser rather than by
   the server. It is not access control; every endpoint is independently
   protected by authentication middleware.
6. Each event has a single venue timezone. An event spanning zones is out of
   scope.
7. Event start and end times are stored to whole-second precision. A range
   shorter than one second is rejected, and it is reachable only through the API
   directly, since the interface's inputs are minute-precision.
8. Events may be created with a start time in the past and remain editable and
   deletable. A planner records events that have already happened as often as
   ones that have not.
9. An event that has already started is listed as past, because the split is on
   start time.
10. Tag names are case-insensitive and trimmed, so `Birthday`, `birthday` and
    `Birthday ` are one tag.
11. Pagination is offset-based, which assumes a page-numbered interface and a
    tolerable cost for an exact total.
12. The database ships empty. There is no seed data, so the first user must
    register.
13. The listing index strategy assumes a public-heavy dataset (section 4.2).

---

## 14. Known limitations

1. **No rate limiting.** Login is not throttled, so the protections in section
   6.5 defend against account enumeration but not against sustained brute force.
   Argon2's cost acts as a partial throttle at roughly 16 ms per attempt.
2. **Daylight-saving rule changes are not reconciled.** If a jurisdiction
   changes its rules after an event is created, the stored instant no longer
   corresponds to the wall time originally intended (section 3.2).
3. **Deep result sets are unreachable.** The offset ceiling of 100,000 makes a
   legitimately deep page inaccessible, which is the price of offset pagination
   (section 4.5).
4. **Search has no fuzzy matching, no internal-substring matching and no
   spelling suggestions**, and MySQL's default stopword list excludes 36 common
   words (section 8.1).
5. **Unknown body keys are reported at form level**, not against a field, since
   no field owns them (section 11.3).
6. **A client serialising array parameters as `tag[]=a` filters nothing and
   receives no error** (section 11.3).
7. **Logging is console-based** at security-relevant points. There is no
   structured logger and no request log.
8. **A date the browser can produce but `Date` cannot parse**, such as a
   six-digit year that Chromium's date input permits, is reported as invalid
   rather than clamped to the supported range.
9. **Account deletion is absent.** This is not a missing endpoint but an
   unanswered product question: `events.creator_id` is `ON DELETE RESTRICT`, so
   removing a user first requires deciding what happens to their events, whether
   they cascade, are reassigned to a tombstone account, or the user is
   soft-deleted. Each affects other users' data and none is a safe default.

---

## 15. Scope

Built beyond the required core: refresh-token rotation with reuse detection,
full-text search, sorting, server-side filtering, database migrations, and an
automated test suite.

Deliberately not built: two-factor authentication, email verification, RSVP
handling and an OpenAPI specification, all of which are optional items. With a
fixed deadline, depth on the required features was preferred over breadth across
optional ones, on the grounds that the subtle parts of the required features are
the ones that fail quietly: a pager that disagrees with its list, a private event
revealed by a status code, a timestamp that moves by the host's offset.

---

## Appendix A. Verification record

Measurements in this document come from two sources, distinguished here so that
each can be reproduced or challenged.

**Executed against the current working tree on 2026-08-29:**

| Check | Result |
|---|---|
| `npm test` | 13 tests, 6 suites, 0 failures |
| `npm run typecheck` | clean across all three workspaces |
| Browser harnesses, ten scripts | 148 checks, 0 failures |
| Duplicate registration | `409 EMAIL_ALREADY_REGISTERED`, no SQL, address or index name in the body |
| Four concurrent registrations of one address | one 201, three 409, no 500 |
| Password length boundaries | 7 rejected, 8 accepted, 128 accepted, 129 rejected |
| Password composition | all-lowercase passphrases accepted at 8 and 128 characters |
| argon2id truncation | a 100-character password sharing 72 bytes with the stored one is refused with 401; the correct password returns 200 |
| Registration session | 201 sets both cookies; `/auth/me` answers 200 with them |
| Missing event, unknown route, invalid body | `NOT_FOUND`, `ROUTE_NOT_FOUND` and `VALIDATION_ERROR` respectively, in the documented envelope |
| Installed dependency copies | one each of `react`, `vite`, `tailwindcss`, `zod`, `express`, `knex` |
| Raw duplicate-key error from the driver | `ER_DUP_ENTRY`, errno 1062, message containing the statement, the address and the index name |
| Schema inspection | five tables, four migrations, indexes and constraints as documented |

**Measured during development on seeded datasets**, which are not part of the
shipped database and are reproducible with the seed scripts: the `CONVERT_TZ`
comparison (10,000 and 510,000 rows), the listing and count plans (200,005
events), the search comparison (202,148 rows), the login timing measurements (40
interleaved pairs), the daylight-saving conversion comparison (10 conversions),
and the contrast and viewport measurements of the interface.

Every performance figure quoted in this document states the dataset it was
measured against. Figures obtained on a demonstration database of a few dozen
events would not distinguish any of the options considered, which is why they
were not used to make these decisions.
