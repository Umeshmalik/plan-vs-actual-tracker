/**
 * The ONE error vocabulary. The frontend renders `message` verbatim, so the
 * wording here IS the user-facing string.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "PERIOD_LOCKED"
  | "UNKNOWN_CATEGORY"
  | "DUPLICATE_PLAN"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  PERIOD_LOCKED: 409,
  UNKNOWN_CATEGORY: 422,
  DUPLICATE_PLAN: 409,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function toResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details ?? {} } },
      { status: STATUS[err.code] }
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields are invalid. Fix the highlighted fields and retry.",
          details: { issues: err.issues.map(i => ({ path: i.path.join("."), message: i.message })) },
        },
      },
      { status: 422 }
    );
  }
  console.error(err);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Retry, and contact support if it persists.",
        details: {},
      },
    },
    { status: 500 }
  );
}
