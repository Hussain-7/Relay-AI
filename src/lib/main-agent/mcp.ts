import { env } from "@/lib/env";

interface ConfiguredMcpServer {
  name: string;
  type: "url";
  url: string;
  authorization_token?: string | null;
  tool_configuration?: {
    allowed_tools?: string[] | null;
    enabled?: boolean | null;
  } | null;
}

const hardcodedMcpServers: ConfiguredMcpServer[] = [];

export function getConfiguredMcpServers() {
  if (!env.ANTHROPIC_MCP_SERVERS_JSON) {
    return hardcodedMcpServers;
  }

  try {
    const parsed = JSON.parse(env.ANTHROPIC_MCP_SERVERS_JSON) as ConfiguredMcpServer[];

    return [...hardcodedMcpServers, ...parsed];
  } catch {
    return hardcodedMcpServers;
  }
}
