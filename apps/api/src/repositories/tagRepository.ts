import type { Knex } from "knex";

type TagRow = {
  id: string | number;
  name: string;
};

function normalizeTagName(name: string): string {
  return name.trim();
}

function tagKey(name: string): string {
  return name.toLowerCase();
}

function toStringId(id: string | number): string {
  return String(id);
}

export async function findOrCreateTags(
  names: string[],
  trx: Knex.Transaction,
): Promise<string[]> {
  const normalizedNames = [
    ...new Map(
      names.map((name) => {
        const normalized = normalizeTagName(name);
        return [tagKey(normalized), normalized];
      }),
    ).values(),
  ];

  if (normalizedNames.length === 0) {
    return [];
  }

  // Find existing tags.
  const existing = await trx<TagRow>("tags")
    .select("id", "name")
    .whereIn("name", normalizedNames);

  const existingByKey = new Map(
    existing.map((tag) => [tagKey(tag.name), toStringId(tag.id)]),
  );

  const missingNames = normalizedNames.filter(
    (name) => !existingByKey.has(tagKey(name)),
  );

  if (missingNames.length > 0) {
    for (const name of missingNames) {
      try {
        // Store the user's casing.
        await trx("tags").insert({ name });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ER_DUP_ENTRY"
        ) {
          // Another request created this tag concurrently. Re-select below.
        } else {
          throw error;
        }
      }
    }
  }

  const tags = await trx<TagRow>("tags")
    .select("id", "name")
    .whereIn("name", normalizedNames)
    .forShare();

  const tagsByKey = new Map(
    tags.map((tag) => [tagKey(tag.name), toStringId(tag.id)]),
  );

  return normalizedNames.map((name) => {
    const id = tagsByKey.get(tagKey(name));

    if (!id) {
      throw new Error(`Tag was not found after creation: ${name}`);
    }

    return id;
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
