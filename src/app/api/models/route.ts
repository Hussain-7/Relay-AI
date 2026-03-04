import { ProviderId } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { ensureModelCatalogSeeded } from "@/lib/model-catalog";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);
    await ensureModelCatalogSeeded();

    const connectedProviders = await prisma.providerCredential.findMany({
      where: {
        userId: auth.userId,
        status: "active",
      },
      select: {
        provider: true,
      },
    });

    const providerSet = new Set(connectedProviders.map((row) => row.provider));
    const providerFilter = [...providerSet];

    const models =
      providerFilter.length === 0
        ? []
        : await prisma.modelCatalog.findMany({
            where: {
              enabled: true,
              provider: {
                in: providerFilter,
              },
            },
            orderBy: [
              { provider: "asc" },
              { tier: "asc" },
              { displayName: "asc" },
            ],
          });

    const aliases =
      providerFilter.length === 0
        ? []
        : await prisma.modelAlias.findMany({
            where: {
              provider: {
                in: providerFilter,
              },
            },
            orderBy: [{ provider: "asc" }, { alias: "asc" }],
          });

    const connected = {
      openai: providerSet.has(ProviderId.OPENAI),
      anthropic: providerSet.has(ProviderId.ANTHROPIC),
    };

    return NextResponse.json({ connected, models, aliases });
  } catch (error) {
    return errorResponse(error);
  }
}
