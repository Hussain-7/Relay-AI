import { type RunEvent } from "@/generated/prisma/client";
import { createClient } from "@supabase/supabase-js";

import type { TimelineEventEnvelope, TimelineEventType, TimelineSource } from "@/lib/contracts";
import { env, hasSupabaseRealtimeConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";

let supabaseServerClient:
  | ReturnType<typeof createClient>
  | null
  | undefined;

function getSupabaseServerClient() {
  if (!hasSupabaseRealtimeConfig()) {
    return null;
  }

  if (supabaseServerClient !== undefined) {
    return supabaseServerClient;
  }

  supabaseServerClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseServerClient;
}

function mapRunEvent(event: RunEvent, conversationId: string): TimelineEventEnvelope {
  return {
    id: event.id,
    runId: event.runId,
    conversationId,
    type: event.type as TimelineEventType,
    source: ((event.payloadJson as Record<string, unknown> | null)?.source as TimelineSource | undefined) ?? "system",
    ts: event.ts.toISOString(),
    payload: (event.payloadJson as Record<string, unknown> | null) ?? null,
  };
}

export async function appendRunEvent(input: {
  runId: string;
  conversationId: string;
  type: TimelineEventType;
  source: TimelineSource;
  payload?: Record<string, unknown> | null;
}) {
  const payloadJson = input.payload ? { ...input.payload, source: input.source } : { source: input.source };

  const event = await prisma.runEvent.create({
    data: {
      runId: input.runId,
      type: input.type,
      payloadJson,
    },
  });

  const envelope = mapRunEvent(event, input.conversationId);
  const supabase = getSupabaseServerClient();

  if (supabase) {
    // Fire-and-forget: use httpSend for server-side REST delivery (no WebSocket needed)
    supabase.channel(`conversation:${input.conversationId}`)
      .httpSend("run_event", envelope)
      .catch(() => {});
  }

  return envelope;
}

export function serializeSseEvent(event: TimelineEventEnvelope) {
  return `data: ${JSON.stringify(event)}\n\n`;
}
