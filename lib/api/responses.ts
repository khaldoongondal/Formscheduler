import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

function validationDetails(error: ZodError) {
  return error.flatten((issue) => {
    // Zod omits raw input from reported issues. Only translate its default missing-value message.
    if (issue.code === "invalid_type" && issue.message === `Invalid input: expected ${issue.expected}, received undefined`) {
      return "Required";
    }
    return issue.message;
  });
}

/** Admin routes only: returns the error text as is. Public routes use failPublic. */
export function fail(error: unknown, status = 400) {
  if (error instanceof ZodError) {
    const flattened = validationDetails(error);
    const fieldMessage = Object.values(flattened.fieldErrors).flat().find(Boolean);
    const formMessage = flattened.formErrors.find(Boolean);

    return NextResponse.json(
      {
        error: fieldMessage ?? formMessage ?? "Validation failed",
        details: flattened
      },
      { status: 422 }
    );
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Unexpected error"
    },
    { status }
  );
}

/** An error whose message is safe to show to the public. */
export class PublicError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "PublicError";
  }
}

export const GENERIC_PUBLIC_ERROR = "Something went wrong. Please try again.";

/**
 * Public routes: only PublicError messages and Zod field messages reach the
 * client. Everything else (Supabase, GoHighLevel, unexpected) is logged and
 * replaced with a generic message.
 */
export function failPublic(error: unknown) {
  if (error instanceof ZodError) {
    const flattened = validationDetails(error);
    const fieldMessage = Object.values(flattened.fieldErrors).flat().find(Boolean);
    return NextResponse.json(
      { error: fieldMessage ?? "Please check your answers and try again." },
      { status: 422 }
    );
  }

  if (error instanceof PublicError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[public-api]", error);
  return NextResponse.json({ error: GENERIC_PUBLIC_ERROR }, { status: 500 });
}
