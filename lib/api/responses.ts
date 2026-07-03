import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: unknown, status = 400) {
  if (error instanceof ZodError) {
    const flattened = error.flatten();
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
