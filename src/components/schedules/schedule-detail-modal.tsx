"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconExternalLink, IconPause, IconPlay, IconTrash } from "@/components/icons";
import { ModalBackdrop, ModalFooter, ModalHeader, ModalPanel } from "@/components/ui/modal";
import {
  useDeleteScheduledPrompt,
  useMcpConnectors,
  useRunScheduledPromptNow,
  useScheduledPromptDetail,
  useUpdateScheduledPrompt,
} from "@/lib/api-hooks";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: "bg-[rgba(122,168,148,0.15)]", text: "text-accent-2", label: "Active" },
  PAUSED: { bg: "bg-[rgba(255,193,7,0.12)]", text: "text-[#ffc107]", label: "Paused" },
  COMPLETED: { bg: "bg-[rgba(255,255,255,0.06)]", text: "text-[rgba(245,240,232,0.5)]", label: "Completed" },
  CANCELLED: { bg: "bg-[rgba(255,255,255,0.04)]", text: "text-[rgba(245,240,232,0.35)]", label: "Cancelled" },
};

const RUN_STATUS_DOT: Record<string, string> = {
  COMPLETED: "bg-accent-2",
  FAILED: "bg-red-400",
  RUNNING: "bg-accent animate-pulse",
  PENDING: "bg-[rgba(255,255,255,0.25)]",
};

export function ScheduleDetailModal({ scheduleId, onClose }: { scheduleId: string; onClose: () => void }) {
  const router = useRouter();
  const { data: schedule, isLoading } = useScheduledPromptDetail(scheduleId);
  const updateMutation = useUpdateScheduledPrompt();
  const deleteMutation = useDeleteScheduledPrompt();
  const runNowMutation = useRunScheduledPromptNow();
  const { data: allConnectors } = useMcpConnectors();

  const status = STATUS_STYLES[schedule?.status ?? "ACTIVE"] ?? STATUS_STYLES.ACTIVE;

  // Resolve MCP connector IDs to names
  const mcpNames = (() => {
    const ids = schedule?.mcpConnectorIds as string[] | null;
    if (!ids?.length || !allConnectors) return [];
    const map = new Map(allConnectors.map((c) => [c.id, c.name]));
    return ids.map((id) => map.get(id) ?? id.slice(0, 8)).filter(Boolean);
  })();

  return (
    <ModalBackdrop onClose={onClose}>
      <ModalPanel className="w-[min(520px,92vw)] max-h-[80vh] flex flex-col border border-[rgba(255,255,255,0.08)] rounded-[20px] bg-[rgba(30,28,24,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden">
        <ModalHeader title="Schedule Details" onClose={onClose} />

        {isLoading || !schedule ? (
          <div className="px-5 py-8 text-center text-[rgba(245,240,232,0.5)] text-[0.86rem]">Loading...</div>
        ) : (
          <div className="px-5 pb-2 flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${status.bg} ${status.text}`}>
                  {status.label}
                </span>
                <span className="text-[0.75rem] text-[rgba(245,240,232,0.4)]">{schedule.cronDescription}</span>
              </div>
              {schedule.label && (
                <h3 className="text-[1rem] font-semibold text-[rgba(245,240,232,0.92)] mb-1">{schedule.label}</h3>
              )}
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-1">
                Prompt
              </label>
              <div className="rounded-[8px] bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-3 text-[0.84rem] text-[rgba(245,240,232,0.8)] leading-relaxed max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                {schedule.prompt}
              </div>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-0.5">
                  Cron
                </label>
                <p className="text-[0.82rem] font-mono text-[rgba(245,240,232,0.7)]">{schedule.cronExpression}</p>
              </div>
              <div>
                <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-0.5">
                  Timezone
                </label>
                <p className="text-[0.82rem] text-[rgba(245,240,232,0.7)]">{schedule.timezone}</p>
              </div>
              <div>
                <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-0.5">
                  Runs
                </label>
                <p className="text-[0.82rem] text-[rgba(245,240,232,0.7)]">
                  {schedule.totalRuns}
                  {schedule.maxRuns ? ` / ${schedule.maxRuns}` : " (unlimited)"}
                </p>
              </div>
              <div>
                <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-0.5">
                  Next run
                </label>
                <p className="text-[0.82rem] text-[rgba(245,240,232,0.7)]">
                  {schedule.nextRunAt
                    ? new Date(schedule.nextRunAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "—"}
                </p>
              </div>
            </div>

            {/* Preferences snapshot */}
            {(schedule.preferencesJson || schedule.notifyEmail) && (
              <div>
                <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-1">
                  Preferences
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const prefs = schedule.preferencesJson as Record<string, unknown> | null;
                    if (!prefs) return null;
                    return (
                      <>
                        {prefs.model ? (
                          <span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[0.72rem] text-[rgba(245,240,232,0.6)]">
                            {String(prefs.model)}
                          </span>
                        ) : null}
                        {prefs.thinking ? (
                          <span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[0.72rem] text-[rgba(245,240,232,0.6)]">
                            Thinking
                          </span>
                        ) : null}
                        {prefs.effort ? (
                          <span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[0.72rem] text-[rgba(245,240,232,0.6)]">
                            Effort: {String(prefs.effort)}
                          </span>
                        ) : null}
                        {schedule.notifyEmail ? (
                          <span className="rounded-full bg-[rgba(221,113,72,0.12)] px-2 py-0.5 text-[0.72rem] text-accent">
                            Email reports
                          </span>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* MCP connectors */}
            {mcpNames.length > 0 && (
              <div>
                <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-1">
                  MCP Connectors
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {mcpNames.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[0.72rem] text-[rgba(245,240,232,0.6)]"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Conversation link */}
            {schedule.conversationId && (
              <button
                type="button"
                className="flex items-center gap-2 w-full text-left rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[0.82rem] text-accent cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                onClick={() => {
                  onClose();
                  router.push(`/chat/${schedule.conversationId}`);
                }}
              >
                <IconExternalLink />
                View conversation: {schedule.conversationTitle || "Scheduled chat"}
              </button>
            )}

            {/* Execution history */}
            {schedule.executions.length > 0 && (
              <div>
                <label className="block text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-2">
                  Recent executions
                </label>
                <div className="flex flex-col gap-1.5">
                  {schedule.executions.map((exec) => (
                    <div
                      key={exec.id}
                      className="flex items-center gap-2.5 rounded-[8px] bg-[rgba(255,255,255,0.02)] px-3 py-2"
                    >
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${RUN_STATUS_DOT[exec.status] ?? "bg-gray-500"}`}
                      />
                      <span className="text-[0.78rem] text-[rgba(245,240,232,0.7)] flex-1 min-w-0">
                        {exec.startedAt
                          ? new Date(exec.startedAt).toLocaleString(undefined, {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "Pending"}
                      </span>
                      {exec.run?.model && (
                        <span className="text-[0.7rem] text-[rgba(245,240,232,0.35)]">
                          {exec.run.model.split("-").pop()}
                        </span>
                      )}
                      {exec.run?.costUsd != null && (
                        <span className="text-[0.7rem] text-[rgba(245,240,232,0.35)]">
                          ${exec.run.costUsd.toFixed(4)}
                        </span>
                      )}
                      {exec.errorMessage && (
                        <span className="text-[0.7rem] text-red-400 truncate max-w-[120px]" title={exec.errorMessage}>
                          {exec.errorMessage}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {schedule && (
          <ModalFooter>
            <div className="flex items-center gap-2 w-full pt-2">
              {(schedule.status === "ACTIVE" || schedule.status === "PAUSED") && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-transparent px-3 py-1.5 text-[0.82rem] text-[rgba(245,240,232,0.7)] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                  onClick={() => {
                    const newStatus = schedule.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
                    updateMutation.mutate(
                      { id: schedule.id, status: newStatus },
                      {
                        onSuccess: () => toast.success(newStatus === "PAUSED" ? "Schedule paused" : "Schedule resumed"),
                      },
                    );
                  }}
                  disabled={updateMutation.isPending}
                >
                  {schedule.status === "ACTIVE" ? <IconPause /> : <IconPlay />}
                  {schedule.status === "ACTIVE" ? "Pause" : "Resume"}
                </button>
              )}

              {schedule.status !== "CANCELLED" && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-transparent px-3 py-1.5 text-[0.82rem] text-accent cursor-pointer hover:bg-[rgba(221,113,72,0.08)] transition-colors"
                  onClick={() =>
                    runNowMutation.mutate(schedule.id, {
                      onSuccess: () =>
                        toast.success("Run triggered", { description: "Execution started in the background" }),
                    })
                  }
                  disabled={runNowMutation.isPending}
                >
                  <IconPlay />
                  Run now
                </button>
              )}

              <div className="flex-1" />

              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(255,80,80,0.2)] bg-transparent px-3 py-1.5 text-[0.82rem] text-red-400 cursor-pointer hover:bg-[rgba(255,80,80,0.08)] transition-colors"
                onClick={() => {
                  deleteMutation.mutate(schedule.id, {
                    onSuccess: () => {
                      toast.success("Schedule deleted");
                      onClose();
                    },
                  });
                }}
                disabled={deleteMutation.isPending}
              >
                <IconTrash />
                Delete
              </button>
            </div>
          </ModalFooter>
        )}
      </ModalPanel>
    </ModalBackdrop>
  );
}
