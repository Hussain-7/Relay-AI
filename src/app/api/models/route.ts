import { getModelCatalog } from "@/lib/main-agent/model";
import { getCached } from "@/lib/server-cache";

export async function GET() {
  const catalog = await getCached("models:catalog", 3600, async () => getModelCatalog());

  return Response.json(catalog, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
