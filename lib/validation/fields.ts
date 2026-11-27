import { z } from "zod";

// PostgreSQL accepts unversioned UUIDs, including the IDs used by existing demo forms.
export const databaseIdSchema = z.string().guid("Invalid uuid");

// Validate without trimming or otherwise rewriting stored tracking and provider URLs.
export const urlStringSchema = z.string().refine((value) => URL.canParse(value), "Invalid url");
