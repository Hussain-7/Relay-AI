import { useState } from "react";
import { api } from "@/lib/api-client";

export function useApproval(runId: string, approvalId: string) {
  const [submitting, setSubmitting] = useState(false);

  async function submit(selectedOption?: string, freeformText?: string) {
    setSubmitting(true);
    try {
      const responseJson: Record<string, unknown> = {};
      if (selectedOption != null) {
        responseJson.selectedOption = selectedOption;
        responseJson.answer = selectedOption;
      } else {
        responseJson.answer = freeformText?.trim() ?? "";
      }
      await api.post(`/api/agent/runs/${runId}/approve`, {
        approvalId,
        status: "APPROVED",
        responseJson,
      });
    } catch {
      setSubmitting(false);
    }
  }

  async function dismiss() {
    setSubmitting(true);
    try {
      await api.post(`/api/agent/runs/${runId}/approve`, {
        approvalId,
        status: "REJECTED",
        responseJson: { reason: "dismissed" },
      });
    } catch {
      setSubmitting(false);
    }
  }

  return { submitting, submit, dismiss };
}
