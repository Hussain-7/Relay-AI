import { Inngest } from "inngest";

const eventKey = process.env.INNGEST_EVENT_KEY;

export const inngest = new Inngest({
  id: "endless-dev",
  ...(eventKey ? { eventKey } : {}),
});
