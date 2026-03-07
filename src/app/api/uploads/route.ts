import Anthropic, { toFile } from "@anthropic-ai/sdk";

import { env, hasAnthropicApiKey } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

function inferAttachmentKind(mediaType: string) {
  if (mediaType.startsWith("image/")) {
    return "IMAGE" as const;
  }

  if (mediaType === "application/pdf") {
    return "PDF" as const;
  }

  if (
    mediaType.startsWith("text/") ||
    mediaType.includes("json") ||
    mediaType.includes("markdown")
  ) {
    return "DOCUMENT" as const;
  }

  return "OTHER" as const;
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const formData = await request.formData();
    const conversationId = formData.get("conversationId");
    const file = formData.get("file");

    if (typeof conversationId !== "string" || !conversationId) {
      return Response.json({ error: "conversationId is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return Response.json({ error: "Expected a file upload." }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: user.userId,
      },
    });

    if (!conversation) {
      return Response.json({ error: "Conversation not found." }, { status: 404 });
    }

    if (!hasAnthropicApiKey()) {
      return Response.json({ error: "ANTHROPIC_API_KEY is required for file uploads." }, { status: 500 });
    }

    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });

    const uploaded = await client.beta.files.upload({
      file: await toFile(await file.arrayBuffer(), file.name, { type: file.type }),
      betas: ["files-api-2025-04-14"],
    });

    const attachment = await prisma.attachment.create({
      data: {
        conversationId,
        filename: file.name,
        mediaType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        kind: inferAttachmentKind(file.type || "application/octet-stream"),
        anthropicFileId: uploaded.id,
        metadataJson: {
          downloadable: uploaded.downloadable ?? false,
        },
      },
    });

    return Response.json({
      attachment: {
        id: attachment.id,
        kind: attachment.kind,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        sizeBytes: attachment.sizeBytes,
        anthropicFileId: attachment.anthropicFileId,
        createdAt: attachment.createdAt.toISOString(),
        metadataJson: attachment.metadataJson,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to upload file.",
      },
      { status: 500 },
    );
  }
}
