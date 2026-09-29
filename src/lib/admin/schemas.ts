import { z } from "zod";
import { isValidTimezone } from "./timezones";

/** Trimmed, lowercased, syntactically valid email. */
export const emailSchema = z
  .string({ error: "Enter an email address" })
  .trim()
  .toLowerCase()
  .min(1, "Enter an email address")
  .max(254, "That email is too long")
  .pipe(z.email("Enter a valid email address"));

export const groupNameSchema = z
  .string({ error: "Enter a group name" })
  .trim()
  .min(1, "Enter a group name")
  .max(40, "Keep it to 40 characters or fewer");

export const timezoneSchema = z
  .string({ error: "Pick a timezone" })
  .refine(isValidTimezone, "Unknown timezone");

/** Row ids are Postgres uuids; reject anything else before it reaches a query. */
export const idSchema = z.guid("Invalid id");

export const idListSchema = z.array(idSchema).min(1, "Pick at least one person").max(200);

/** First zod issue as a user-facing sentence. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
