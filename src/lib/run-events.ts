import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

let cachedServiceClient: SupabaseClient | null | undefined;

function getSupabaseServiceClient(): SupabaseClient | null {
  if (cachedServiceClient !== undefined) {
    return cachedServiceClient;
  }

  const env = getEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    cachedServiceClient = null;
    return cachedServiceClient;
  }

  cachedServiceClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return cachedServiceClient;
}

async function publishRunEventRealtime(
  runId: string,
  event: { id: string; ts: Date; type: string; payloadJson: unknown },
) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return;
  }

  const channel = supabase.channel(`run:${runId}`);

  const status = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      resolve("TIMED_OUT");
    }, 1500);

    channel.subscribe((nextStatus) => {
      if (
        nextStatus === "SUBSCRIBED" ||
        nextStatus === "CHANNEL_ERROR" ||
        nextStatus === "TIMED_OUT"
      ) {
        clearTimeout(timer);
        resolve(nextStatus);
      }
    });
  });

  if (status === "SUBSCRIBED") {
    await channel.send({
      type: "broadcast",
      event: "run.event",
      payload: {
        id: event.id,
        runId,
        ts: event.ts.toISOString(),
        type: event.type,
        payload: event.payloadJson,
      },
    });
  }

  await supabase.removeChannel(channel);
}

export async function appendRunEvent(
  runId: string,
  type: string,
  payload: unknown,
) {
  const event = await prisma.runEvent.create({
    data: {
      runId,
      type,
      payloadJson: payload as object,
    },
  });

  void publishRunEventRealtime(runId, {
    id: event.id,
    ts: event.ts,
    type: event.type,
    payloadJson: event.payloadJson,
  }).catch(() => {
    // Event persistence is authoritative; realtime fan-out is best effort.
  });

  return event;
}

export async function listRunEvents(runId: string) {
  return prisma.runEvent.findMany({
    where: { runId },
    orderBy: { ts: "asc" },
  });
}
