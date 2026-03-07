import { getModelCatalog } from "@/lib/main-agent/tool-catalog";

export async function GET() {
  return Response.json(getModelCatalog());
}
