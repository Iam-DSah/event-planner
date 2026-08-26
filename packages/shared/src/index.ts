import { z } from "zod";

// Auth

export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(255),
    password: z.string().min(8).max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(255),
    password: z.string().min(1).max(128),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

// Events

// Event listing

const positiveIntegerStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Must be a positive integer");

const MAX_OFFSET = 100_000;
const MAX_TAGS = 20;

const eventListSortSchema = z.enum(["startsAt", "createdAt"]);

const eventListOrderSchema = z.enum(["asc", "desc"]);

const eventListTagSchema = z
  .string()
  .trim()
  .min(1, "Tag must not be empty")
  .max(50, "Tag must be 50 characters or fewer");

export const eventListQuerySchema = z
  .object({
    page: positiveIntegerStringSchema.default("1").transform(Number),

    limit: positiveIntegerStringSchema
      .default("20")
      .transform(Number)
      .refine((value) => value <= 100, {
        message: "limit must be between 1 and 100",
      }),

    tag: z
      .union([eventListTagSchema, z.array(eventListTagSchema)])
      .optional()
      .transform((value) => {
        if (value === undefined) {
          return [];
        }

        const values = Array.isArray(value) ? value : [value];

        // MySQL uses a case-insensitive collation for tags.name,
        // so dedupe using lowercase keys while preserving
        // the first spelling supplied by the client.
        const seen = new Set<string>();
        const tags: string[] = [];

        for (const value of values) {
          const key = value.toLowerCase();

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          tags.push(value);
        }

        return tags;
      })
      .refine((tags) => tags.length <= MAX_TAGS, {
        message: `A maximum of ${MAX_TAGS} unique tags may be provided`,
      }),

    visibility: z.enum(["public", "private"]).optional(),

    // A query-string boolean, spelled as an enum rather than a coercion so
    // that `?mine=yes` is a 400 instead of quietly meaning false — the same
    // treatment `sort` and `order` already get. Defaulting to "false" keeps a
    // bare /events unchanged.
    mine: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    when: z.enum(["upcoming", "past", "all"]).default("upcoming"),

    sort: eventListSortSchema.default("startsAt"),

    order: eventListOrderSchema.default("asc"),
  })
  .transform((query) => ({
    page: query.page,
    limit: query.limit,
    tags: query.tag,
    visibility: query.visibility,
    mine: query.mine,
    when: query.when,
    sort: query.sort,
    order: query.order,
  }))
  .superRefine((data, ctx) => {
    const offset = (data.page - 1) * data.limit;

    if (offset > MAX_OFFSET) {
      ctx.addIssue({
        code: "custom",
        path: ["page"],
        message: "Requested page is too far into the result set",
      });
    }
  });

export type EventListQueryInput = z.infer<typeof eventListQuerySchema>;

const eventFields = {
  title: z.string().trim().min(1).max(200),

  // Empty textarea value is treated as "no description".
  description: z
    .string()
    .trim()
    .max(5_000)
    .nullable()
    .optional()
    .transform((value) => {
      if (value === "" || value === undefined) {
        return null;
      }

      return value;
    }),

  startsAt: z.string().datetime({
    offset: true,
  }),

  endsAt: z
    .string()
    .datetime({
      offset: true,
    })
    .nullable()
    .optional(),

  location: z.string().trim().min(1).max(255),

  visibility: z.enum(["public", "private"]).optional(),

  timezone: z.string().min(1),

  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
};

const eventBaseSchema = z.object(eventFields).strict();

function isValidIanaTimezone(value: string): boolean {
  // Intl is used only to determine whether the runtime recognises
  // the timezone. We deliberately do not compare its canonical
  // output because ICU versions can canonicalize zone names
  // differently.

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    });

    // Exclude fixed offsets such as "+05:45".
    // Require the normal IANA Region/City form.
    if (!value.includes("/")) {
      return value === "UTC";
    }

    const [region, city] = value.split("/");

    return (
      Boolean(region) &&
      Boolean(city) &&
      !value.startsWith("/") &&
      !value.endsWith("/")
    );
  } catch {
    return false;
  }
}

function addEventTimeAndTimezoneValidation(
  data: z.infer<typeof eventBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (
    data.endsAt !== undefined &&
    data.endsAt !== null &&
    new Date(data.endsAt) <= new Date(data.startsAt)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "endsAt must be after startsAt",
    });
  }

  if (!isValidIanaTimezone(data.timezone)) {
    ctx.addIssue({
      code: "custom",
      path: ["timezone"],
      message: "timezone must be a valid IANA timezone",
    });
  }
}

export const createEventSchema = eventBaseSchema.superRefine(
  addEventTimeAndTimezoneValidation,
);

export type CreateEventInput = z.infer<typeof createEventSchema>;

// UPDATE

export const updateEventSchema = eventBaseSchema
  .partial()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "At least one field must be provided",
      });
    }

    if (
      data.startsAt !== undefined &&
      data.endsAt !== undefined &&
      data.startsAt !== null &&
      data.endsAt !== null &&
      new Date(data.endsAt) <= new Date(data.startsAt)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "endsAt must be after startsAt",
      });
    }

    // PATCH timezone only needs validation when timezone is supplied.
    if (data.timezone !== undefined && !isValidIanaTimezone(data.timezone)) {
      ctx.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "timezone must be a valid IANA timezone",
      });
    }
  });

export type UpdateEventInput = z.infer<typeof updateEventSchema>;
