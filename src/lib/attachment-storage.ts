import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

const ATTACHMENTS_BUCKET = "attachments";

// Singleton Supabase client for storage operations (shared across all callers)
let _client: ReturnType<typeof createClient> | null = null;
export function getSupabaseStorageClient(): ReturnType<typeof createClient> {
  if (!_client) {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required).");
    }
    _client = createClient(supabaseUrl, serviceKey);
  }
  return _client;
}

// Check-once pattern per bucket to prevent race condition on concurrent creation
const _bucketReady = new Map<string, Promise<void>>();

export function ensureBucketExists(
  bucket: string,
  options?: { fileSizeLimit?: number; allowedMimeTypes?: string[] },
): Promise<void> {
  let promise = _bucketReady.get(bucket);
  if (!promise) {
    promise = (async () => {
      const supabase = getSupabaseStorageClient();
      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.some((b) => b.name === bucket)) {
        const { error } = await supabase.storage.createBucket(bucket, {
          public: true,
          fileSizeLimit: options?.fileSizeLimit ?? 50 * 1024 * 1024,
          allowedMimeTypes: options?.allowedMimeTypes,
        });
        if (error && !error.message.includes("already exists")) {
          _bucketReady.delete(bucket);
          throw new Error(`Failed to create storage bucket '${bucket}': ${error.message}`);
        }
      }
    })();
    _bucketReady.set(bucket, promise);
  }
  return promise;
}

/**
 * Upload a buffer to the attachments bucket in Supabase Storage.
 * Returns the public URL for the uploaded file.
 */
export async function uploadAttachment(
  buffer: Buffer | Uint8Array,
  filename: string,
  mediaType: string,
): Promise<string> {
  const supabase = getSupabaseStorageClient();
  await ensureBucketExists(ATTACHMENTS_BUCKET);

  // Sanitize filename: replace spaces and special chars with underscores
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;

  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(storagePath, buffer, {
    contentType: mediaType,
    cacheControl: "public, max-age=31536000, immutable",
    upsert: false,
  });

  if (error) {
    throw new Error(`Failed to upload attachment: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(storagePath);

  return publicUrl;
}

/**
 * Download content from a storage URL into a Buffer.
 */
export async function downloadFromStorageUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download from storage: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
