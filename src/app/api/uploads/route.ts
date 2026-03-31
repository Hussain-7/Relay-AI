import Anthropic, { toFile } from "@anthropic-ai/sdk";

import { uploadAttachment } from "@/lib/attachment-storage";
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

  if (mediaType.startsWith("text/") || mediaType.includes("json") || mediaType.includes("markdown")) {
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

    if (!(file instanceof File)) {
      return Response.json({ error: "Expected a file upload." }, { status: 400 });
    }

    // conversationId is optional — files can be uploaded before a conversation exists
    // (e.g. on /chat/new) and linked later when the message is sent
    if (conversationId && typeof conversationId === "string") {
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, userId: user.userId },
      });
      if (!conversation) {
        return Response.json({ error: "Conversation not found." }, { status: 404 });
      }
    }

    if (!hasAnthropicApiKey()) {
      return Response.json({ error: "ANTHROPIC_API_KEY is required for file uploads." }, { status: 500 });
    }

    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const mediaType = file.type || "application/octet-stream";

    const uploaded = await client.beta.files.upload({
      file: await toFile(fileBuffer, file.name, { type: file.type }),
      betas: ["files-api-2025-04-14"],
    });

    // Upload to Supabase Storage for fast serving (non-blocking if it fails)
    let storageUrl: string | null = null;
    try {
      storageUrl = await uploadAttachment(fileBuffer, file.name, mediaType);
    } catch (err) {
      console.warn("[uploads] Supabase Storage upload failed, will use Anthropic fallback:", (err as Error).message);
    }

    const validConvId = typeof conversationId === "string" && conversationId ? conversationId : null;
    const attachment = await prisma.attachment.create({
      data: {
        ...(validConvId ? { conversation: { connect: { id: validConvId } } } : {}),
        filename: file.name,
        mediaType,
        sizeBytes: file.size,
        kind: inferAttachmentKind(mediaType),
        anthropicFileId: uploaded.id,
        storageUrl,
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
        storageUrl: attachment.storageUrl,
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
