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
