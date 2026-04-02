import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Capture process-level errors (missing envs, startup crashes, unhandled rejections)
    process.on("unhandledRejection", (reason) => {
      Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
        tags: { type: "unhandledRejection" },
      });
    });
    process.on("uncaughtException", (error) => {
      Sentry.captureException(error, { tags: { type: "uncaughtException" } });
    });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
