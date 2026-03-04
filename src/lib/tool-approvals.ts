import { ApprovalStatus, Prisma, RunStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

export interface ApprovalProposal {
  kind: string;
  title: string;
  reason: string;
  payload?: Record<string, unknown>;
}

export async function ensureToolApprovedOrRequest(
  runId: string,
  proposal: ApprovalProposal,
): Promise<void> {
  const approved = await prisma.runApproval.findFirst({
    where: {
      runId,
      kind: proposal.kind,
      status: ApprovalStatus.APPROVED,
    },
    select: { id: true },
  });

  if (approved) {
    return;
  }

  const existingPending = await prisma.runApproval.findFirst({
    where: {
      runId,
      kind: proposal.kind,
      status: ApprovalStatus.PENDING,
    },
  });

  let approvalId = existingPending?.id;

  if (!existingPending) {
    const created = await prisma.runApproval.create({
      data: {
        runId,
        kind: proposal.kind,
        proposalJson: {
          title: proposal.title,
          reason: proposal.reason,
          payload: proposal.payload ?? {},
        } as unknown as Prisma.InputJsonValue,
      },
    });
    approvalId = created.id;
  }

  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: RunStatus.AWAITING_APPROVAL,
    },
  });

  await appendRunEvent(runId, "approval.required", {
    approvalId,
    kind: proposal.kind,
    title: proposal.title,
    reason: proposal.reason,
    payload: proposal.payload ?? {},
  });

  throw new Error(`Approval required: ${proposal.title}`);
}
