import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;

    const run = await prisma.agentRun.findFirst({
      where: {
        id,
        userId: user.userId,
      },
      include: {
        events: {
          orderBy: [{ ts: "asc" }, { id: "asc" }],
        },
        approvals: {
          orderBy: { createdAt: "asc" },
        },
        attachments: {
          orderBy: { createdAt: "asc" },
        },
        codingSession: {
          include: {
            repoBinding: true,
          },
        },
      },
    });

    if (!run) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }

    return Response.json({ run });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to load run.",
      },
      { status: 500 },
    );
  }
}
