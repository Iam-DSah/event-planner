import { z } from "zod";

// Auth

export const registerSchema = z
  .object({
    name: z
      .string({ error: "Name is required" })
      .trim()
      .min(1, "Name is required")
      .max(100, "Name must be 100 characters or fewer"),
    email: z
      .string({ error: "Email is required" })
      .trim()
      .min(1, "Email is required")
      .email("Enter a valid email address")
      .max(255, "Email must be 255 characters or fewer"),
    password: z
      .string({ error: "Password is required" })
      .min(1, "Password is required")
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be 128 characters or fewer"),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z
      .string({ error: "Email is required" })
      .trim()
      .min(1, "Email is required")
      .email("Enter a valid email address")
      .max(255, "Email must be 255 characters or fewer"),
    password: z
      .string({ error: "Password is required" })
      .min(1, "Password is required")
      .max(128, "Password must be 128 characters or fewer"),
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

const eventListSortSchema = z.enum(["startsAt", "createdAt", "relevance"]);

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

    q: z.string().trim().min(1, "Search must not be empty").max(100).optional(),

    visibility: z.enum(["public", "private"]).optional(),

    mine: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    when: z.enum(["upcoming", "past", "all"]).default("upcoming"),

    sort: eventListSortSchema.optional(),

    order: eventListOrderSchema.optional(),
  })
  .transform((query) => {
    const sort =
      query.sort ?? (query.q === undefined ? "startsAt" : "relevance");

    return {
      page: query.page,
      limit: query.limit,
      q: query.q,
      tags: query.tag,
      visibility: query.visibility,
      mine: query.mine,
      when: query.when,
      sort,
      order: query.order ?? (sort === "relevance" ? "desc" : "asc"),
    };
  })
  .superRefine((data, ctx) => {
    if (data.sort === "relevance" && data.q === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sort"],
        message: "sort=relevance requires a search query",
      });
    }

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
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer"),

  // Empty textarea value is treated as "no description".
  description: z
    .string()
    .trim()
    .max(5_000, "Description must be 5000 characters or fewer")
    .nullable()
    .optional()
    .transform((value) => {
      if (value === "" || value === undefined) {
        return null;
      }

      return value;
    }),

  startsAt: z.string({ error: "Start date and time is required" }).datetime({
    offset: true,
    message: "Enter a valid start date and time",
  }),

  endsAt: z
    .string()
    .datetime({
      offset: true,
      message: "Enter a valid end date and time",
    })
    .nullable()
    .optional(),

  location: z
    .string({ error: "Location is required" })
    .trim()
    .min(1, "Location is required")
    .max(255, "Location must be 255 characters or fewer"),

  visibility: z.enum(["public", "private"]).optional(),

  timezone: z
    .string({ error: "Timezone is required" })
    .min(1, "Timezone is required"),

  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, "A tag cannot be empty")
        .max(50, "A tag must be 50 characters or fewer"),
    )
    .max(20, "You can add up to 20 tags")
    .optional(),
};

const eventBaseSchema = z.object(eventFields).strict();

function isValidIanaTimezone(value: string): boolean {
  // Intl is used only to determine whether the runtime recognizes
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

export function toStoredSecond(value: string | Date): number {
  return Math.round(new Date(value).getTime() / 1000);
}

function addEventTimeAndTimezoneValidation(
  data: z.infer<typeof eventBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (
    data.endsAt !== undefined &&
    data.endsAt !== null &&
    toStoredSecond(data.endsAt) <= toStoredSecond(data.startsAt)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "The end time must be after the start time",
    });
  }

  if (!isValidIanaTimezone(data.timezone)) {
    ctx.addIssue({
      code: "custom",
      path: ["timezone"],
      message: "Choose a valid timezone",
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
        message: "Change at least one field before saving",
      });
    }

    if (
      data.startsAt !== undefined &&
      data.endsAt !== undefined &&
      data.startsAt !== null &&
      data.endsAt !== null &&
      toStoredSecond(data.endsAt) <= toStoredSecond(data.startsAt)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end time must be after the start time",
      });
    }

    // PATCH timezone only needs validation when timezone is supplied.
    if (data.timezone !== undefined && !isValidIanaTimezone(data.timezone)) {
      ctx.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Choose a valid timezone",
      });
    }
  });

export type UpdateEventInput = z.infer<typeof updateEventSchema>;
