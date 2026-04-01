import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { scheduleDispatcher } from "@/lib/inngest/functions/schedule-dispatcher";
import { scheduleExecutor } from "@/lib/inngest/functions/schedule-executor";

// Allow long-running agent executions (up to 5 minutes)
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [scheduleDispatcher, scheduleExecutor],
});
