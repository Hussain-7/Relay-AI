import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { env, hasGoogleAiConfig } from "@/lib/env";
import { getGoogleAiClient } from "@/lib/google-ai";
import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const imageGenerationCatalog: ToolCatalogEntry = {
  id: "image_generation",
  label: "Image generation",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "Generate or edit images using Google AI models (Imagen 4, Gemini).",
};

const MODEL_MAP = {
  "imagen-4": "imagen-4.0-generate-001",
  "gemini-3-pro-image": "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image": "gemini-3.1-flash-image-preview",
} as const;

type ModelAlias = keyof typeof MODEL_MAP;

const STORAGE_BUCKET = "generated-images";

const inputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("Detailed description of the image to generate or how to edit the existing image."),
  model: z
    .enum(["imagen-4", "gemini-3-pro-image", "gemini-3.1-flash-image"])
    .describe(
      "Model to use. imagen-4: pixel-perfect photorealistic output — ads, product renders, high-end design. Text-to-image ONLY, no editing. gemini-3-pro-image: thinking + design + control — infographics, UI mockups, text-heavy visuals, complex layouts. Supports editing. gemini-3.1-flash-image: fast, scalable — social media, bulk content, rapid prototyping. Supports editing.",
    ),
  imageAttachmentId: z
    .string()
    .optional()
    .describe(
      "For editing an existing image: the attachment ID of the source image. MUST use a Gemini model (not imagen-4) when providing this.",
    ),
  aspectRatio: z.string().optional().describe("Aspect ratio, e.g. '16:9', '1:1', '9:16'. Defaults to '1:1'."),
});

async function resolveInputImage(attachmentId: string, userId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      content: true,
      mediaType: true,
      metadataJson: true,
      conversation: { select: { userId: true } },
      run: { select: { userId: true } },
    },
  });

  if (!attachment) {
    throw new Error(`Attachment ${attachmentId} not found.`);
  }

  const ownerUserId = attachment.conversation?.userId ?? attachment.run?.userId;
  if (ownerUserId !== userId) {
    throw new Error("You do not have access to this attachment.");
  }

  // If content bytes are stored in DB, use them directly
  if (attachment.content) {
    return {
      base64: Buffer.from(attachment.content).toString("base64"),
      mimeType: attachment.mediaType,
    };
  }

  // Fall back to downloading from publicUrl (generated images are stored in Supabase Storage)
  const meta = attachment.metadataJson as Record<string, unknown> | null;
  const publicUrl = meta?.publicUrl as string | undefined;
  if (!publicUrl) {
    throw new Error(`Attachment ${attachmentId} has no content and no public URL.`);
  }

  console.log(`[image_generation] Downloading input image from public URL: ${publicUrl}`);
  const response = await fetch(publicUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image from ${publicUrl}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    base64: buffer.toString("base64"),
    mimeType: attachment.mediaType,
  };
}

async function generateWithImagen(prompt: string, modelId: string, aspectRatio: string) {
  const google = await getGoogleAiClient();
  console.log(`[image_generation] Calling Imagen: model=${modelId}, aspectRatio=${aspectRatio}`);
  const response = await google.models.generateImages({
    model: modelId,
    prompt,
    config: {
      numberOfImages: 1,
      outputMimeType: "image/png",
      aspectRatio,
    },
  });

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageBytes) {
    console.error(
      "[image_generation] Imagen returned no image data. Response:",
      JSON.stringify(response).slice(0, 500),
    );
    throw new Error(
      "Imagen returned no image data. This usually means the prompt was blocked by the safety filter " +
        "(e.g. references to real people, celebrities, copyrighted characters, or violent/sensitive content). " +
        "Try rephrasing without real names or identifiable individuals.",
    );
  }

  console.log(`[image_generation] Imagen returned image: ${imageBytes.length} chars base64`);
  return Buffer.from(imageBytes, "base64");
}

async function generateWithGemini(prompt: string, modelId: string, inputImage?: { base64: string; mimeType: string }) {
  const google = await getGoogleAiClient();
  console.log(`[image_generation] Calling Gemini: model=${modelId}, hasInputImage=${Boolean(inputImage)}`);

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];

  if (inputImage) {
    parts.push({
      inlineData: {
        mimeType: inputImage.mimeType,
        data: inputImage.base64,
      },
    });
  }

  const response = await google.models.generateContent({
    model: modelId,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) {
    console.error("[image_generation] Gemini returned no content. Response:", JSON.stringify(response).slice(0, 500));
    throw new Error("Gemini returned no content.");
  }

  console.log(`[image_generation] Gemini returned ${candidate.content.parts.length} parts`);

  const imagePart = candidate.content.parts.find((p) => "inlineData" in p && p.inlineData);

  if (!imagePart?.inlineData?.data) {
    const partTypes = candidate.content.parts.map((p) => Object.keys(p).join(",")).join("; ");
    console.error(`[image_generation] Gemini returned no image data. Part types: ${partTypes}`);
    throw new Error("Gemini returned no image data. The model may have refused the request.");
  }

  console.log(
    `[image_generation] Gemini image: mimeType=${imagePart.inlineData.mimeType}, data=${imagePart.inlineData.data.length} chars`,
  );
  return Buffer.from(imagePart.inlineData.data, "base64");
}

/**
 * Upload image buffer to Supabase Storage and return public URL.
 * Uses the service role key for server-side uploads to a public bucket.
 */
async function uploadToSupabaseStorage(buffer: Buffer, filename: string): Promise<string> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required).");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Auto-create bucket on first use
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === STORAGE_BUCKET)) {
    console.log(`[image_generation] Creating storage bucket: ${STORAGE_BUCKET}`);
    const { error: bucketError } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (bucketError && !bucketError.message.includes("already exists")) {
      console.error("[image_generation] Bucket creation error:", bucketError);
      throw new Error(`Failed to create storage bucket: ${bucketError.message}`);
    }
  }

  const storagePath = `${Date.now()}-${filename}`;
  console.log(
    `[image_generation] Uploading to Supabase Storage: bucket=${STORAGE_BUCKET}, path=${storagePath}, size=${buffer.length}`,
  );

  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
    upsert: false,
  });

  if (uploadError) {
    console.error("[image_generation] Supabase upload error:", uploadError);
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

  console.log(`[image_generation] Public URL: ${urlData.publicUrl}`);
  return urlData.publicUrl;
}

export function createImageGenerationTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "image_generation",
    description:
      "Generate or edit images using Google AI models. Returns a public imageUrl.\n" +
      "IMPORTANT: After this tool returns, you MUST include the imageUrl in your response using markdown: ![description](imageUrl)\n" +
      "Models:\n" +
      "- imagen-4: pixel-perfect photorealistic output — ads, product renders, high-end design. Text-to-image ONLY, no editing.\n" +
      "- gemini-3-pro-image: thinking + design + control — infographics, UI mockups, text-heavy visuals, complex layouts. Supports editing.\n" +
      "- gemini-3.1-flash-image: fast, scalable — social media, bulk content, rapid prototyping. Supports editing.\n" +
      "For editing an existing image, MUST use a Gemini model and provide imageAttachmentId.",
    inputSchema,
    async run(input) {
      if (!hasGoogleAiConfig()) {
        const result = jsonResult({ error: "GOOGLE_AI_API_KEY is not configured." });
        await ctx.emit("tool.call.failed", {
          toolName: "image_generation",
          toolRuntime: "custom",
          input,
          error: "GOOGLE_AI_API_KEY is not configured.",
        });
        return result;
      }

      const modelAlias = input.model as ModelAlias;
      const modelId = MODEL_MAP[modelAlias];
      const aspectRatio = input.aspectRatio ?? "1:1";

      if (input.imageAttachmentId && modelAlias === "imagen-4") {
        const error =
          "Imagen 4 does not support image editing. Use gemini-3-pro-image or gemini-3.1-flash-image instead.";
        await ctx.emit("tool.call.failed", {
          toolName: "image_generation",
          toolRuntime: "custom",
          input,
          error,
        });
        return jsonResult({ error });
      }

      console.log(
        `[image_generation] Starting: model=${modelAlias} (${modelId}), aspectRatio=${aspectRatio}, editing=${Boolean(input.imageAttachmentId)}`,
      );

      try {
        // Resolve input image if editing
        let inputImage: { base64: string; mimeType: string } | undefined;
        if (input.imageAttachmentId) {
          console.log(`[image_generation] Resolving input image: ${input.imageAttachmentId}`);
          inputImage = await resolveInputImage(input.imageAttachmentId, ctx.userId);
        }

        // Generate image
        let imageBuffer: Buffer;
        if (modelAlias === "imagen-4") {
          imageBuffer = await generateWithImagen(input.prompt, modelId, aspectRatio);
        } else {
          imageBuffer = await generateWithGemini(input.prompt, modelId, inputImage);
        }

        console.log(`[image_generation] Image generated: ${imageBuffer.length} bytes`);

        // Upload to Supabase Storage → get public URL
        const filename = `generated-${crypto.randomUUID()}.png`;
        const publicUrl = await uploadToSupabaseStorage(imageBuffer, filename);

        // Create Attachment record (for conversation history / output attachments display)
        const attachment = await prisma.attachment.create({
          data: {
            conversationId: ctx.conversationId,
            runId: ctx.runId,
            kind: "IMAGE",
            filename,
            mediaType: "image/png",
            sizeBytes: imageBuffer.length,
            metadataJson: {
              source: "image_generation",
              model: input.model,
              prompt: input.prompt,
              publicUrl,
            },
          },
        });

        console.log(`[image_generation] Attachment created: id=${attachment.id}, publicUrl=${publicUrl}`);

        const result = jsonResult({
          success: true,
          attachmentId: attachment.id,
          imageUrl: publicUrl,
          model: input.model,
          message: `Image generated successfully. You MUST display it by including this in your response: ![Generated image](${publicUrl})`,
        });

        await ctx.emit("tool.call.completed", {
          toolName: "image_generation",
          toolRuntime: "custom",
          input,
          result: result.slice(0, 2000),
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image generation failed.";
        console.error(`[image_generation] Error:`, error);

        await ctx.emit("tool.call.failed", {
          toolName: "image_generation",
          toolRuntime: "custom",
          input,
          error: message,
        });

        return jsonResult({ error: message });
      }
    },
  });
}
