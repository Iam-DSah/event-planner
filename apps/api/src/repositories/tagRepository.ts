import type { Knex } from "knex";

type TagRow = {
  id: string | number;
  name: string;
};

function tagKey(name: string): string {
  return name.toLowerCase();
}

export async function findOrCreateTags(
  names: string[],
  trx: Knex.Transaction,
): Promise<TagRow[]> {
  if (names.length === 0) {
    return [];
  }

  // Deduplicate using the same case-insensitive identity as MySQL.
  // Preserve the first spelling supplied by the user.
  const uniqueNames = new Map<string, string>();

  for (const name of names) {
    const key = name.toLowerCase();

    if (!uniqueNames.has(key)) {
      uniqueNames.set(key, name);
    }
  }

  // Important for concurrent inserts:
  // acquire locks in a deterministic order regardless of the order
  // in which the client supplied the tags.
  // Compare the lowercase keys directly. localeCompare depends on the runtime
  // locale (ä sorts before z under de, after it under sv), so two processes
  // could sort the same names differently and lose the lock ordering entirely.
  const normalizedNames = [...uniqueNames.values()].sort((a, b) => {
    const left = tagKey(a);
    const right = tagKey(b);

    if (left === right) {
      return 0;
    }

    return left < right ? -1 : 1;
  });

  // No LOWER() on the column: utf8mb4_0900_ai_ci already compares
  // case-insensitively, and wrapping `name` in a function turns a unique-index
  // seek (type: const) into a full index scan (key: NULL).
  const existingRows = await trx("tags")
    .select("id", "name")
    .whereIn("name", normalizedNames);

  const existingByKey = new Map<string, TagRow>();

  for (const row of existingRows) {
    existingByKey.set(row.name.toLowerCase(), {
      id: row.id,
      name: row.name,
    });
  }

  const missingNames = normalizedNames.filter(
    (name) => !existingByKey.has(name.toLowerCase()),
  );

  // Create missing tags one at a time.
  //
  // We intentionally handle ER_DUP_ENTRY rather than using INSERT IGNORE:
  // INSERT IGNORE can hide unrelated data errors.
  for (const name of missingNames) {
    // The try wraps the INSERT and nothing else, so the only errors this catch
    // inspects are the driver's. Our own throws stay outside it.
    let insertedId: number | undefined;

    try {
      [insertedId] = await trx("tags").insert({ name });
    } catch (error) {
      const isDuplicate =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY";

      if (!isDuplicate) {
        throw error;
      }

      // Another transaction created the tag between our SELECT and INSERT.
      //
      // Re-select it using the transaction's current locking read: under
      // REPEATABLE READ a plain SELECT would still see the snapshot taken
      // before that transaction committed, and find nothing.
      const row = await trx("tags")
        .select("id", "name")
        .where("name", name)
        .forShare()
        .first();

      if (!row) {
        throw error;
      }

      existingByKey.set(tagKey(row.name), {
        id: row.id,
        name: row.name,
      });

      continue;
    }

    if (insertedId === undefined) {
      throw new Error(`Tag "${name}" could not be created`);
    }

    existingByKey.set(tagKey(name), {
      id: insertedId,
      name,
    });
  }

  // Return in the same deterministic order as normalizedNames.
  return normalizedNames.map((name) => {
    const tag = existingByKey.get(name.toLowerCase());

    if (!tag) {
      throw new Error(`Tag "${name}" could not be resolved`);
    }

    return tag;
  });
}

export async function replaceEventTags(
  eventId: string,
  tagIds: string[],
  trx: Knex.Transaction,
): Promise<void> {
  await trx("event_tags").where("event_id", eventId).del();

  if (tagIds.length === 0) {
    return;
  }

  await trx("event_tags").insert(
    tagIds.map((tagId) => ({
      event_id: eventId,
      tag_id: tagId,
    })),
  );
}

export async function findTagsForEvents(
  eventIds: string[],
  executor: Knex | Knex.Transaction,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  for (const eventId of eventIds) {
    result.set(eventId, []);
  }

  if (eventIds.length === 0) {
    return result;
  }

  const rows = await executor("event_tags")
    .join("tags", "tags.id", "event_tags.tag_id")
    .select("event_tags.event_id", "tags.name")
    .whereIn("event_tags.event_id", eventIds);

  for (const row of rows) {
    const eventId = String(row.event_id);

    result.get(eventId)!.push(row.name);
  }

  return result;
}
