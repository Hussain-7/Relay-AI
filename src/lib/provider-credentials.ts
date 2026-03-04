import { ProviderId, ProviderCredential } from "@prisma/client";
import { decryptSecret, type EncryptedSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export interface DecryptedProviderCredential {
  provider: ProviderId;
  apiKey: string;
}

function parseEncryptedBlob(blob: string): EncryptedSecret {
  const parsed = JSON.parse(blob) as EncryptedSecret;
  if (
    !parsed?.ciphertext ||
    !parsed?.iv ||
    !parsed?.authTag ||
    !parsed?.keyVersion
  ) {
    throw new Error("Invalid encrypted credential payload");
  }
  return parsed;
}

function decryptCredential(
  row: ProviderCredential,
): DecryptedProviderCredential {
  return {
    provider: row.provider,
    apiKey: decryptSecret(parseEncryptedBlob(row.encryptedKeyBlob)),
  };
}

export async function getActiveProviderCredentials(
  userId: string,
): Promise<DecryptedProviderCredential[]> {
  const rows = await prisma.providerCredential.findMany({
    where: {
      userId,
      status: "active",
    },
  });

  return rows.map(decryptCredential);
}

export async function getProviderCredential(
  userId: string,
  provider: ProviderId,
): Promise<DecryptedProviderCredential | null> {
  const row = await prisma.providerCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
  });

  if (!row || row.status !== "active") {
    return null;
  }

  return decryptCredential(row);
}
