import { Inngest } from "inngest";

type ScheduledPromptExecuteEvent = {
  data: {
    scheduledPromptId: string;
    nextRunAt: string;
  };
};

type Events = {
  "scheduled-prompt/execute": ScheduledPromptExecuteEvent;
};

export const inngest = new Inngest({ id: "relay-ai", schemas: new Map() as never });

export type { Events };
