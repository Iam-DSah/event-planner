# Event Planning Application

Users register, sign in, and create events with a title, description, start and
end time, location, timezone, tags and a public/private flag. Events are listed
with server-side pagination, filtering by tag, visibility, creator and
upcoming/past, full-text search and sorting. Only an event's creator can edit
or delete it.

## Stack

Versions are those installed in `node_modules`, not the ranges declared in
`package.json`.

| Layer | Choice |
|---|---|
| Backend | Node ≥ 20 (developed on 24.16.0), Express 5.2.1, TypeScript 5.9.3 |
| Database | MySQL 8.4.11 in Docker, Knex 3.3.0 (queries + migrations), mysql2 3.23.3 |
| Frontend | React 19.2.8, React Router 7.18.2, Vite 7.3.6 |
| Shared | Zod 4.4.3 schemas, imported by both sides |
| Auth | `@node-rs/argon2` 2.1.0, `jsonwebtoken` 9.0.3 |

No ORM; all SQL goes through Knex's query builder.

## Setup

Requires Node ≥ 20, Docker running, and ports 3000, 5173 and 3306 free.

```bash
npm install                  # npm workspaces; hoists to the repo root

cp .env.example .env

# generate a signing key, then REPLACE the JWT_SECRET line in .env with it:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm run db:up                # MySQL 8.4 in Docker; --wait blocks until healthy
npm run migrate:latest       # 4 migrations

npm run dev                  # terminal 1 — API on http://localhost:3000
npm run dev:web              # terminal 2 — Vite on http://localhost:5173
```

Open **http://localhost:5173** and register. The database ships empty; there is
no seed data.

Two terminals because npm workspaces has no parallel runner — the root `dev`
script starts only the API. Both scripts live at the repository root.

Use `localhost`, not a LAN or container IP: the API accepts credentialed
requests from exactly one origin (`WEB_ORIGIN`, default
`http://localhost:5173`), so another hostname loads the page and then fails
every API call.

The API refuses to start if `JWT_SECRET` is absent or under 32 characters. That
is deliberate — see *Assumptions*.

These steps were last verified by destroying the Docker volume
(`npm run db:reset`) and running them in order against an empty database.

## Running the tests

```bash
npm test        # 13 tests, node --test via tsx. Needs MySQL up and migrated.
```

No dev server or browser needed: `app.ts` exports the Express app without
binding a port, so the suite starts its own listener on an ephemeral port.

The scope is deliberate — the rules where a **wrong answer is silent**, and the
caller still gets a healthy-looking response: creator-only mutation; a private
event answering 404 with a body byte-identical to a nonexistent event's;
`pagination.total` built by the same `WHERE` as the rows; a timestamp surviving
storage unshifted; search terms sanitised and short terms still matching.

Loud failures — a crash, a 500, a blank page — are found by running the app
once and need no test.

The suite was verified by mutation: each rule was deliberately broken in the
source and the suite confirmed to catch it. That found two defective tests,
which is why it was done rather than trusting a green result.

## API

All routes are under `/api/v1`, JSON in and out. Authentication is an
`httpOnly` cookie, so there is no `Authorization` header.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | create an account; sets both cookies |
| POST | `/auth/login` | — | sets both cookies |
| POST | `/auth/logout` | — | clears both cookies |
| POST | `/auth/refresh` | refresh cookie | rotate the refresh token, reissue the access token |
| GET | `/auth/me` | yes | the current user |
| GET | `/events` | yes | list; paginated and filtered |
| POST | `/events` | yes | create |
| GET | `/events/:id` | yes | one event |
| PATCH | `/events/:id` | yes | update (creator only) |
| DELETE | `/events/:id` | yes | delete (creator only) |
| GET | `/health` | — | `200` healthy, `503` if the database is unreachable |

`GET /events` accepts `page`, `limit`, `tag` (repeatable), `visibility`,
`mine`, `when` (`upcoming` \| `past` \| `all`), `q`, `sort`, `order`.

Errors are always `{ "error": { "code", "message" } }`, plus a `fields` map for
validation failures. The frontend branches on `code`, never on the message.
`ROUTE_NOT_FOUND` (no such URL) is deliberately distinct from `NOT_FOUND` (the
handler ran; the resource does not exist).

## Data model

```
users ──1:N──> events ──M:N──> tags        (via event_tags)
  └───1:N──> refresh_tokens
```

Third normal form. A tag name is stored once and referenced by id, so an
event's tags are rows rather than a delimited string — which is what makes
`?tag=` an indexed join instead of a `LIKE` scan.

Foreign keys carry the intent. `events.creator_id` is `ON DELETE RESTRICT`, so
a user owning events cannot be deleted silently; `event_tags` and
`refresh_tokens.user_id` are `ON DELETE CASCADE`, because a join row and a
session are meaningless without their parent.

`tags.name` is `UNIQUE` under `utf8mb4_0900_ai_ci`, which is case-insensitive,
so `Birthday` and `birthday` are one tag. That collation is NO PAD, so trailing
whitespace would create a duplicate — tag names are trimmed in application code
first.

## Engineering decisions

### 1. A monorepo with a shared validation package

The brief requires validation on both sides. Two independent projects means
writing every rule twice and finding the divergence in production.
`packages/shared` holds the Zod schemas and both sides import them, so a rule
exists once and cannot drift — the list page parses its own query string with
the very schema the API validates against.

Cost accepted: dependency hoisting. Two packages wanting different majors of
one library yields two installed copies, which breaks at runtime while
typecheck and build both pass.

### 2. Time is a UTC instant; the timezone is display-only

`starts_at` holds a UTC instant. `timezone` holds an IANA name used only to
render it in the venue's local time, and never appears in a `WHERE` clause.

That restriction is the decision, and it is what keeps the upcoming/past split
usable. Filtering on the bare column is an index range scan; wrapping it in
`CONVERT_TZ` to compare local times forces MySQL to compute a value per row, so
no index can serve it and the query becomes a full table scan. The cost grows
with the table, so the version that looks more correct is the one that stops
working first.

The consequence for the application is that "upcoming" means upcoming in UTC,
for everyone. An event at 9am in Kathmandu and one at 9am in London are ordered
by the instant they actually occur, not by their local clock readings, which is
the ordering a shared list needs.

mysql2 is pinned to `timezone: 'Z'` so the driver never applies the host's
offset. Wall-clock to instant takes two passes in the browser, because one pass
is an hour out just after a spring-forward transition.

### 3. argon2id, not bcrypt

argon2id is memory-hard, which is what makes GPU cracking expensive. Parameters
are passed explicitly — 19,456 KiB, 2 iterations, 1 lane, the OWASP baseline —
rather than left to defaults, because they are the security decision.

bcrypt also ignores everything past 72 bytes. Demonstrated: hash a
106-character password, then verify a different 106-character password
sharing only its first 72 bytes. bcrypt returns `true`; argon2id returns
`false`.

### 4. A short-lived access cookie, with rotated refresh tokens

The access token is a JWT in an `httpOnly`, `Secure`, `SameSite=Lax` cookie,
valid 15 minutes, verified statelessly with `HS256` pinned. It carries `sub`
and nothing else: a JWT is signed, not encrypted, and every extra claim is
database state frozen at issue time.

A 15-minute absolute token is only coherent with a refresh token behind it, so
refresh tokens are implemented: opaque `randomBytes(32)`, SHA-256 hashed at
rest, rotated on every use, grouped into families so replaying a spent token
revokes the whole family. Their cookie is scoped to `Path=/api/v1/auth`.

### 5. Login answers identically for an unknown email and a wrong password

Same status, same message. That alone is insufficient: "no such user" returns
immediately while "wrong password" pays for a hash verification, and the gap is
measurable with a stopwatch. So the unknown-email path performs a discarded
verification against a dummy hash. Over 40 interleaved pairs:

| | unknown email | wrong password | gap |
|---|---|---|---|
| as implemented | 14.61 ms | 14.40 ms | **0.20 ms** |
| dummy verification removed | 2.79 ms | 15.55 ms | **12.77 ms** |

The dummy hash is computed at startup, not hardcoded: argon2 reads its cost
parameters out of the hash string, so a stale literal would keep verifying at
the old cost and silently reopen the gap.

Relatedly, the login schema validates shape, not policy — a non-empty password,
not an 8-character one. Rejecting a short guess with `400` where a real attempt
gets `401` replaces a timing oracle with a status-code one.

### 6. Authorization reads the row, decides, then writes — in one transaction

The ownership rule lives in a service, not as an extra `AND creator_id = ?` on
the `UPDATE`. A `WHERE` that matches nothing cannot distinguish "not yours"
from "does not exist", so it cannot produce the right status code — and the
decision belongs somewhere testable without HTTP. Read, decision and write
share a transaction, so the row cannot vanish between check and update.

**A private event that is not yours answers `404`, never `403`.** A `403`
confirms it exists, which is what its owner made it private to avoid. The body
is byte-identical to a nonexistent event's; differing by one word is still an
oracle. `403` is used only for mutating a *public* event you do not own, where
existence is no secret. `pagination.total` excludes private rows for the same
reason.

### 7. Domain errors become HTTP status codes at exactly one edge

Services throw typed domain errors carrying a code and a client-safe message; a
single handler owns the only mapping to status codes. Nothing below the
controller knows HTTP exists, which is what makes the authorization rule
testable as a plain function.

Unexpected errors return a generic 500 with the stack going only to the log,
and library errors are never mapped directly: the driver's duplicate-key
message contains the offending SQL and the submitted email address, so a
duplicate registration is translated where the query runs.

### 8. Indexes where a requirement justifies them; the rest settled with EXPLAIN

Every index costs write throughput, so each traces to a query the brief asks
for. The listing query filters a grouped `OR` — public events plus your own —
ordered by start time, and an index on `starts_at` serves both the filter and
the ordering, so the first page is read straight from the index and stops as
soon as it has twenty rows.

That advantage decays with depth. Measured on 200,000 rows, the first page
returns in about a millisecond; a thousand rows deep is an order of magnitude
slower; and by an offset of fifty thousand MySQL abandons the index for a table
scan roughly a hundred times slower than the first page. The reason is inherent
to offset pagination — the database cannot skip rows it has not examined, so the
work grows with the offset rather than with the page size. Offsets beyond
100,000 are therefore rejected outright: a depth no genuine user reaches by
clicking, and the point past which the query stops being cheap.

The exact total is the expensive half regardless of depth: the same filter
without a `LIMIT` has no early exit and must examine every matching row. That is
the standing price of showing "page 3 of 47" rather than an infinite scroll, and
it is why the count and the rows are built by one shared `WHERE` builder — two
builders would let the number drift from the list with nothing erroring.

### 9. FULLTEXT search, with a per-token LIKE fallback

`?q=` searches title, description and location through a `FULLTEXT` index in
BOOLEAN mode, every term required, ordered by relevance. On 200,037 rows, for a
term matching one row: `MATCH … AGAINST('+147258*')` takes **0.30 ms**; the
equivalent `LIKE '%147258%'` across three columns takes **97.97 ms**.

Input is sanitised first, because `+ - ~ < > ( ) " * @` are BOOLEAN operators —
unsanitised, searching a hyphenated name is read as *NOT* and returns the
opposite of what was asked. They become spaces rather than being deleted, so
`Yoga@Home` is two searchable words, not one unmatchable one.

InnoDB does not index tokens under three characters, so `q=AI` returned nothing
while "AI Conference" was on screen — a required term that cannot match zeroes
the query. Short terms now fall back to `LIKE`, **per token**, so a mixed-length
query still narrows through the index on the words it can:

| | rows |
|---|---|
| `q=AI` through the application | 1 |
| `MATCH … AGAINST('+AI*')` alone | 0 |
| `MATCH … AGAINST('+Conference*')` (control) | 1 |

### 10. Frontend session and list state

Auth state has three values, not two. With only "user" or "null", `null` means
both "still checking" and "signed out", so a signed-in user is bounced to the
login page on every refresh. Guards render nothing and return while the check
is in flight rather than redirecting.

A 401 triggers one refresh, retried exactly once, with concurrent requests
sharing a single in-flight refresh. Routing is a function of auth state and
lives entirely in the guards: no page calls `navigate()` after signing in,
because a page and a guard both navigating on one state change is a race the
guard wins — discarding the deep link the user arrived with.

The events list keeps filters, search, sort and page **in the URL**, so a
filtered list is shareable, survives a refresh, and works with Back. There is
no `useState` mirror, because two stores for one fact means Back updates only
one.

## Assumptions

- A user is identified by their email address; there is no username.
- **Access tokens are verified statelessly**, so a user deleted mid-session
  keeps access until the token expires — at most 15 minutes. Refresh tokens are
  stored server-side and revocable immediately.
- **`Secure` is set on cookies unconditionally**, including in development.
  Browsers accept `Secure` cookies over `http://localhost`, and failing closed
  is the safer default.
- **CORS allows one origin and is enforced by the browser, not the server.** It
  is not access control; every endpoint is independently protected by auth
  middleware.
- Each event has a single venue timezone. An event spanning zones is out of
  scope.
- **Events may be created with a start time in the past**, and are then editable
  and deletable like any other. Nothing rejects a past date on either side. This
  is deliberate: a planner records events that have already happened as often as
  ones that have not.
- **An event that has already started lists as past** — the split is on start
  time, so an in-progress event appears under past.
- Tag names are case-insensitive and trimmed: `Birthday`, `birthday` and
  `Birthday ` are one tag.
- **The database ships empty**; no seed data is committed, so the first user
  must register.
- **A placeholder in `.env.example` must fail validation.** The example
  `JWT_SECRET` is deliberately shorter than the enforced 32-character minimum,
  so forgetting to replace it stops the app at startup rather than running on a
  signing key published in this repository.
- Pagination is offset-based, which assumes a page-numbered UI and a tolerable
  cost for an exact total.

## Known limitations

- **Unknown-field validation errors are not attached to a field**; they report
  against the object. Only reachable by a hand-written request.
- **Logging is `console`-based**, at security-relevant points only. No
  structured logger, no request log.
- **No rate limiting.** Login is not throttled, so the guarantees above defend
  against enumeration but not sustained brute force.

## Scope

Built beyond the required core: refresh-token rotation with reuse detection,
full-text search, sorting, server-side filtering, Knex migrations, and an
automated test suite.

Deliberately not built: two-factor authentication, email verification, RSVP and Swagger/OpenAPI
all on the brief's optional list. With a fixed deadline, depth on the required features
beat breadth across optional ones, because it is the subtle features that fail quietly.

Account deletion is also absent. It is not a missing CRUD endpoint:
`events.creator_id` is `ON DELETE RESTRICT`, so removing a user first requires
deciding what happens to their events — cascade, reassign to a tombstone
account, or soft-delete the user. Each affects other users' data, and none is a
default.
