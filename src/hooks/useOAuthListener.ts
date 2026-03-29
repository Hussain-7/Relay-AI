import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "@/lib/api-hooks";

/**
 * Listen for OAuth popup postMessage events (MCP connector authorization).
 * Returns the current error state and a function to open the OAuth popup.
 */
export function useOAuthListener() {
  const queryClient = useQueryClient();
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "mcp-connector-linked") {
        setOauthError(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors });
      }
      if (event.data?.type === "mcp-connector-error") {
        setOauthError(String(event.data.error ?? "OAuth authorization failed"));
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors });
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [queryClient]);

  function authorize(connectorId: string) {
    setOauthError(null);
    window.open(`/api/mcp-connectors/${connectorId}/authorize`, "mcp-oauth", "width=600,height=700,popup=yes");
  }

  return { oauthError, authorize };
}
