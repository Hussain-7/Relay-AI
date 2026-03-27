"use client";

import { useState } from "react";

import { api } from "@/lib/api-client";
import type { RenderTimelineEntry } from "@/lib/chat-utils";

type ApprovalEntry = Extract<RenderTimelineEntry, { kind: "approval" }>;

export function ApprovalCard({ entry }: { entry: ApprovalEntry }) {
  const [freeformText, setFreeformText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(selectedOption?: string) {
    setSubmitting(true);
    try {
      const responseJson: Record<string, unknown> = {};
      if (selectedOption != null) {
        responseJson.selectedOption = selectedOption;
        responseJson.answer = selectedOption;
      } else {
        responseJson.answer = freeformText.trim();
      }

      await api.post(`/api/agent/runs/${entry.runId}/approve`, {
        approvalId: entry.approvalId,
        status: "APPROVED",
        responseJson,
      });
    } catch {
      setSubmitting(false);
    }
  }

  async function handleDismiss() {
    setSubmitting(true);
    try {
      await api.post(`/api/agent/runs/${entry.runId}/approve`, {
        approvalId: entry.approvalId,
        status: "REJECTED",
        responseJson: { reason: "dismissed" },
      });
    } catch {
      setSubmitting(false);
    }
  }

  // Answered state
  if (entry.status === "answered") {
    const answer =
      typeof entry.response?.answer === "string"
        ? entry.response.answer
        : typeof entry.response?.selectedOption === "string"
          ? entry.response.selectedOption
          : null;
    return (
      <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <div className="text-[rgba(245,240,232,0.52)] text-[0.92rem] leading-[1.55]">{entry.question}</div>
        {answer ? (
          <div className="mt-2 inline-flex items-center rounded-lg bg-[rgba(122,168,148,0.12)] px-3 py-1.5 text-[0.88rem] text-[rgba(190,222,209,0.9)]">
            {answer}
          </div>
        ) : null}
      </div>
    );
  }

  // Timeout / rejected / dismissed state
  if (entry.status === "timeout" || entry.status === "rejected") {
    const label = entry.status === "timeout" ? "Timed out" : "Dismissed";
    return (
      <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <div className="text-[rgba(245,240,232,0.52)] text-[0.92rem] leading-[1.55]">{entry.question}</div>
        <div className="mt-2 inline-flex items-center rounded-lg bg-[rgba(181,103,69,0.1)] px-3 py-1.5 text-[0.82rem] text-[rgba(243,199,180,0.8)]">
          {label}
        </div>
      </div>
    );
  }

  // Pending state
  return (
    <div className="rounded-xl border border-[rgba(232,210,162,0.15)] bg-[rgba(232,210,162,0.03)] px-4 py-3.5">
      <div className="text-[rgba(245,240,232,0.92)] text-[0.96rem] font-medium leading-[1.55]">{entry.question}</div>

      {entry.options && entry.options.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {entry.options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={submitting}
              onClick={() => handleSubmit(option)}
              className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3.5 py-1.5 text-[0.88rem] text-[rgba(245,240,232,0.85)] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.16)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}

      {entry.allowFreeform ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            placeholder="Type your answer…"
            value={freeformText}
            onChange={(e) => setFreeformText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeformText.trim() && !submitting) {
                handleSubmit();
              }
            }}
            disabled={submitting}
            className="flex-1 min-w-0 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-[0.88rem] text-[rgba(245,240,232,0.9)] placeholder:text-[rgba(245,240,232,0.35)] outline-none focus:border-[rgba(255,255,255,0.2)] disabled:opacity-50"
          />
          <button
            type="button"
            disabled={submitting || !freeformText.trim()}
            onClick={() => handleSubmit()}
            className="inline-grid place-items-center rounded-lg bg-[rgba(255,255,255,0.08)] px-3.5 py-1.5 text-[0.88rem] text-[rgba(245,240,232,0.85)] transition-colors hover:bg-[rgba(255,255,255,0.12)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            ) : (
              "Send"
            )}
          </button>
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between">
        <button
          type="button"
          disabled={submitting}
          onClick={handleDismiss}
          className="text-[0.78rem] text-[rgba(245,240,232,0.38)] hover:text-[rgba(245,240,232,0.55)] transition-colors cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
