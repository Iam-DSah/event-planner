import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "./app.js";
import db from "./db/knex.js";

const stamp = Date.now();
const PASSWORD = "correct-horse-battery";
const TAG = `Test${stamp}`;

let server: Server;
let base: string;

type Session = (path: string, opts?: RequestInit) => Promise<Response>;

function session(): Session {
  const jar: string[] = [];
  return async (path, opts = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...opts,
      headers: {
        // Content-Type only when there is a body — see the CORS note in
        // apps/web/src/api/client.ts; the same rule applies here for parity.
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(jar.length ? { cookie: jar.join("; ") } : {}),
      },
    });
    for (const c of res.headers.getSetCookie()) jar.push(c.split(";")[0]!);
    return res;
  };
}

async function signUp(name: string): Promise<Session> {
  const api = session();
  const res = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name,
      email: `${name.toLowerCase()}-${stamp}@example.com`,
      password: PASSWORD,
    }),
  });
  assert.equal(res.status, 201, `fixture: could not register ${name}`);
  return api;
}

type Event = { id: string; title: string; startsAt: string; timezone: string };
type ErrorBody = { error: { code: string; message: string } };
type ListBody = {
  events: Event[];
  pagination: { page: number; limit: number; total: number };
};

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

async function createEvent(
  api: Session,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<Event> {
  const res = await api("/events", {
    method: "POST",
    body: JSON.stringify({
      title: `${title} ${stamp}`,
      startsAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
      location: "Kathmandu",
      timezone: "UTC",
      visibility: "public",
      tags: [TAG],
      ...extra,
    }),
  });
  assert.equal(res.status, 201, `fixture: could not create "${title}"`);
  return (await json<{ event: Event }>(res)).event;
}

let ram: Session;
let hari: Session;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  ram = await signUp("Ram");
  hari = await signUp("Hari");
});

after(async () => {
  const emails = `%-${stamp}@example.com`;

  try {
    const userIds = await db("users")
      .where("email", "like", emails)
      .pluck("id");

    if (userIds.length > 0) {
      // Events before users: creator_id is ON DELETE RESTRICT (D005).
      // event_tags follows via CASCADE; the tags row does not.
      await db("events").whereIn("creator_id", userIds).del();
    }

    await db("users").where("email", "like", emails).del();
    await db("tags").where({ name: TAG }).del();
  } finally {
    await db.destroy();
    server.closeAllConnections();
    server.close();
  }
});

describe("creator-only mutation", () => {
  it("refuses a PATCH from someone who did not create the event", async () => {
    const event = await createEvent(ram, "Ram public");

    const res = await hari(`/events/${event.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Hari was here" }),
    });

    assert.equal(res.status, 403);
    // 403 rather than 404 is correct here and only here: the event is public,
    // so Hari can already read it. Its existence is not a secret to protect.
    assert.equal((await json<ErrorBody>(res)).error.code, "FORBIDDEN");
  });

  it("refuses a DELETE from someone who did not create the event", async () => {
    const event = await createEvent(ram, "Ram undeletable");

    const res = await hari(`/events/${event.id}`, { method: "DELETE" });

    assert.equal(res.status, 403);
  });

  it("allows the creator to edit and delete", async () => {
    const event = await createEvent(ram, "Ram editable");

    const patched = await ram(`/events/${event.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: `Renamed ${stamp}` }),
    });
    assert.equal(patched.status, 200);
    assert.equal(
      (await json<{ event: Event }>(patched)).event.title,
      `Renamed ${stamp}`,
    );

    const deleted = await ram(`/events/${event.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 204);

    assert.equal((await ram(`/events/${event.id}`)).status, 404);
  });
});

describe("a private event that is not yours does not exist", () => {
  it("answers 404 with a body byte-identical to a nonexistent event's", async () => {
    const secret = await createEvent(ram, "Ram private", {
      visibility: "private",
    });

    const forbidden = await hari(`/events/${secret.id}`);
    const missing = await hari("/events/999999999");

    assert.equal(forbidden.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(
      await json<ErrorBody>(forbidden),
      await json<ErrorBody>(missing),
    );
  });

  it("answers 404 rather than 403 when a non-creator tries to edit it", async () => {
    const secret = await createEvent(ram, "Ram private edit", {
      visibility: "private",
    });

    const res = await hari(`/events/${secret.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Hari was here" }),
    });

    // The public-event case above returns 403. Here 403 would confirm the
    // event exists, so the visibility check has to run first.
    assert.equal(res.status, 404);
  });

  it("still shows the event to its creator", async () => {
    const secret = await createEvent(ram, "Ram private own", {
      visibility: "private",
    });

    assert.equal((await ram(`/events/${secret.id}`)).status, 200);
  });
});

describe("pagination.total is built by the same WHERE as the rows", () => {
  it("counts what the viewer can see, and nothing else", async () => {
    const shared = await createEvent(ram, "Total public");
    const secret = await createEvent(ram, "Total secret", {
      visibility: "private",
    });

    const mine = await json<ListBody>(await ram(`/events?tag=${TAG}&limit=50`));
    const theirs = await json<ListBody>(
      await hari(`/events?tag=${TAG}&limit=50`),
    );
    const ids = (r: ListBody) => r.events.map((e) => e.id);

    assert.equal(mine.pagination.total, mine.events.length);
    assert.equal(theirs.pagination.total, theirs.events.length);

    assert.ok(ids(mine).includes(secret.id));
    assert.ok(!ids(theirs).includes(secret.id));
    assert.ok(ids(theirs).includes(shared.id));
  });

  it("keeps total at the full count when a page holds less", async () => {
    await createEvent(ram, "Paged one");
    await createEvent(ram, "Paged two");

    const all = await json<ListBody>(await ram(`/events?tag=${TAG}&limit=50`));
    const first = await json<ListBody>(await ram(`/events?tag=${TAG}&limit=1`));

    assert.ok(all.pagination.total >= 2);
    assert.equal(first.events.length, 1);
    // The point of the test: `limit` truncates the ROWS and must not touch the
    // COUNT, or a two-page result would report itself as one page long.
    assert.equal(first.pagination.total, all.pagination.total);
  });
});

describe("the endsAt rule the schema cannot enforce", () => {
  it("compares an incoming endsAt against the STORED startsAt", async () => {
    const startsAt = "2026-12-25T18:00:00.000Z";
    const event = await createEvent(ram, "Backwards", {
      startsAt,
      endsAt: "2026-12-25T20:00:00.000Z",
    });

    // Only endsAt is sent. The shared schema compares the two ends of the
    // range, but it can only do that when BOTH arrive — here the value to
    // compare against is in the database, which the schema cannot see. This
    // is the reason the same rule exists a second time in eventService.
    const res = await ram(`/events/${event.id}`, {
      method: "PATCH",
      body: JSON.stringify({ endsAt: "2026-12-25T09:00:00.000Z" }),
    });
    const body = await json<{
      error: { code: string; fields: Record<string, string[]> };
    }>(res);

    assert.equal(res.status, 400);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    // Byte-identical to the schema's wording. Two code paths enforce one rule,
    // and the user must not be able to tell which one rejected them. A mutation
    // audit found this copy untested: the browser cannot reach it, because the
    // form validates with the full object before it ever calls the API.
    assert.deepEqual(body.error.fields.endsAt, [
      "The end time must be after the start time",
    ]);
  });
});

describe("timezone round trip", () => {
  it("returns the instant it was given, and the zone alongside it", async () => {
    const startsAt = "2026-12-25T03:30:00.000Z";

    const created = await createEvent(ram, "Kathmandu party", {
      startsAt,
      timezone: "Asia/Kathmandu",
    });
    const read = await json<{ event: Event }>(
      await ram(`/events/${created.id}`),
    );

    assert.equal(new Date(read.event.startsAt).toISOString(), startsAt);
    assert.equal(read.event.timezone, "Asia/Kathmandu");

    const [rows] = await db.raw(
      "SELECT DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS stored_at " +
        "FROM events WHERE id = ?",
      [created.id],
    );

    assert.equal(rows[0].stored_at, "2026-12-25 03:30:00");
  });
});

describe("search", () => {
  it("finds a term shorter than the full-text index's minimum", async () => {
    const conf = await createEvent(ram, "AI Conference");

    const res = await json<ListBody>(await ram(`/events?tag=${TAG}&q=AI`));

    assert.ok(res.events.some((e) => e.id === conf.id));
  });

  it("treats a boolean operator as punctuation, not as an instruction", async () => {
    const conf = await createEvent(ram, "Venue search");

    const plain = await json<ListBody>(await ram(`/events?tag=${TAG}&q=Venue`));
    const prefixed = await json<ListBody>(
      await ram(`/events?tag=${TAG}&q=-Venue`),
    );

    assert.ok(plain.events.some((e) => e.id === conf.id));
    assert.deepEqual(
      prefixed.events.map((e) => e.id),
      plain.events.map((e) => e.id),
    );
  });

  it("returns nothing for a query that is only punctuation", async () => {
    const res = await json<ListBody>(
      await ram(`/events?tag=${TAG}&q=${encodeURIComponent("+++")}`),
    );

    assert.equal(res.pagination.total, 0);
    assert.equal(res.events.length, 0);
  });
});
