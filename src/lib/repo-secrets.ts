import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "@/lib/mcp-token-crypto";

const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface RepoSecretSummary {
  id: string;
  key: string;
  hasValue: boolean;
  updatedAt: string;
}

/**
 * List secrets for a repo binding (keys only, no values).
 * Verifies the caller owns the binding.
 */
export async function listRepoSecrets(
  userId: string,
  repoBindingId: string,
): Promise<RepoSecretSummary[]> {
  const binding = await prisma.repoBinding.findUnique({
    where: { id: repoBindingId },
    select: { userId: true },
  });
  if (!binding || binding.userId !== userId) {
    throw new Error("Repo binding not found.");
  }

  const secrets = await prisma.repoSecret.findMany({
    where: { repoBindingId },
    select: { id: true, key: true, updatedAt: true },
    orderBy: { key: "asc" },
  });

  return secrets.map((s) => ({
    id: s.id,
    key: s.key,
    hasValue: true,
    updatedAt: s.updatedAt.toISOString(),
  }));
}

/**
 * Bulk upsert secrets for a repo binding.
 * Entries with an empty value string are skipped (existing value is preserved).
 */
export async function upsertRepoSecrets(
  userId: string,
  repoBindingId: string,
  secrets: { key: string; value: string }[],
): Promise<void> {
  const binding = await prisma.repoBinding.findUnique({
    where: { id: repoBindingId },
    select: { userId: true },
  });
  if (!binding || binding.userId !== userId) {
    throw new Error("Repo binding not found.");
  }

  // Validate keys
  const seenKeys = new Set<string>();
  for (const s of secrets) {
    if (!KEY_REGEX.test(s.key)) {
      throw new Error(`Invalid key format: "${s.key}". Keys must match [A-Za-z_][A-Za-z0-9_]*.`);
    }
    if (seenKeys.has(s.key)) {
      throw new Error(`Duplicate key: "${s.key}".`);
    }
    seenKeys.add(s.key);
  }

  // Filter to only entries with non-empty values (empty = keep existing)
  const toUpsert = secrets.filter((s) => s.value !== "");

  await prisma.$transaction(
    toUpsert.map((s) => {
      const { encrypted, iv } = encryptToken(s.value);
      return prisma.repoSecret.upsert({
        where: { repoBindingId_key: { repoBindingId, key: s.key } },
        create: { repoBindingId, key: s.key, encryptedValue: encrypted, valueIv: iv },
        update: { encryptedValue: encrypted, valueIv: iv },
      });
    }),
  );
}

/**
 * Delete a single secret by ID. Verifies ownership.
 */
export async function deleteRepoSecret(
  userId: string,
  repoBindingId: string,
  secretId: string,
): Promise<void> {
  const secret = await prisma.repoSecret.findUnique({
    where: { id: secretId },
    include: { repoBinding: { select: { userId: true } } },
  });
  if (!secret || secret.repoBindingId !== repoBindingId || secret.repoBinding.userId !== userId) {
    throw new Error("Secret not found.");
  }

  await prisma.repoSecret.delete({ where: { id: secretId } });
}

/**
 * Get decrypted secrets for a repo binding (server-only, for sandbox provisioning).
 */
export async function getDecryptedSecrets(
  repoBindingId: string,
): Promise<{ key: string; value: string }[]> {
  const secrets = await prisma.repoSecret.findMany({
    where: { repoBindingId },
    orderBy: { key: "asc" },
  });

  return secrets.map((s) => ({
    key: s.key,
    value: decryptToken(s.encryptedValue, s.valueIv),
  }));
}

/**
 * Build a `.env` file string from decrypted secrets.
 * Values containing special characters are double-quoted with escaping.
 */
export function buildDotEnvContent(secrets: { key: string; value: string }[]): string {
  const lines = secrets.map(({ key, value }) => {
    // Quote values that contain spaces, #, newlines, or quotes
    if (/[\s#"'\\$`!]/.test(value) || value === "") {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
      return `${key}="${escaped}"`;
    }
    return `${key}=${value}`;
  });
  return lines.join("\n") + "\n";
}
