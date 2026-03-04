import { ZodError } from "zod";

export type ErrorResponseBody = {
  error: string;
  details?: unknown;
};

export function errorResponse(error: unknown, fallbackStatus = 500): Response {
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "Validation error",
        details: error.flatten(),
      } satisfies ErrorResponseBody,
      { status: 400 },
    );
  }

  if (error instanceof Error) {
    const status = inferStatusFromMessage(error.message) ?? fallbackStatus;
    return Response.json(
      {
        error: error.message,
      } satisfies ErrorResponseBody,
      { status },
    );
  }

  return Response.json(
    {
      error: "Unexpected error",
      details: typeof error === "object" ? error : String(error),
    } satisfies ErrorResponseBody,
    { status: fallbackStatus },
  );
}

function inferStatusFromMessage(message: string): number | null {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("missing bearer token")
  ) {
    return 401;
  }
  if (normalized.includes("forbidden")) {
    return 403;
  }
  if (normalized.includes("not found")) {
    return 404;
  }
  if (normalized.includes("conflict")) {
    return 409;
  }
  return null;
}
