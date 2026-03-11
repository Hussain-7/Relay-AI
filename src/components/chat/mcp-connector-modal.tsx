"use client";

import { useCallback, useEffect, useState } from "react";

import {
  useMcpConnectors,
  useCreateMcpConnector,
  useDeleteMcpConnector,
  useToggleMcpConnector,
  queryKeys,
  type McpConnectorDto,
} from "@/lib/api-hooks";
import { IconClose } from "@/components/icons";
import { useQueryClient } from "@tanstack/react-query";

function StatusDot({ status }: { status: McpConnectorDto["status"] }) {
  const color =
    status === "ACTIVE"
      ? "bg-emerald-400"
      : status === "NEEDS_AUTH"
        ? "bg-amber-400"
        : status === "ERROR"
          ? "bg-red-400"
          : "bg-[rgba(255,255,255,0.25)]";

  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function statusLabel(status: McpConnectorDto["status"]) {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "NEEDS_AUTH":
      return "Needs auth";
    case "ERROR":
      return "Error";
    case "DISABLED":
      return "Disabled";
  }
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-150 ${enabled ? "bg-[rgba(212,112,73,0.7)]" : "bg-[rgba(255,255,255,0.12)]"}`}
      onClick={() => onChange(!enabled)}
    >
      <span className={`pointer-events-none inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-150 translate-y-[2px] ${enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

export function McpConnectorModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: connectors = [], isLoading } = useMcpConnectors();
  const createMutation = useCreateMcpConnector();
  const deleteMutation = useDeleteMcpConnector();
  const toggleMutation = useToggleMcpConnector();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Listen for OAuth popup completion or error
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "mcp-connector-linked") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors });
      }
      if (event.data?.type === "mcp-connector-error") {
        setFormError(String(event.data.error ?? "OAuth authorization failed"));
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors });
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [queryClient]);

  const handleSubmit = useCallback(async () => {
    setFormError(null);

    if (!name.trim() || !url.trim()) {
      setFormError("Name and URL are required");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        url: url.trim(),
        authorizationToken: token.trim() || undefined,
      });

      if (result.needsAuth) {
        // Open OAuth popup
        window.open(
          `/api/mcp-connectors/${result.connector.id}/authorize`,
          "mcp-oauth",
          "width=600,height=700,popup=yes",
        );
      }

      setName("");
      setUrl("");
      setToken("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add connector");
    }
  }, [name, url, token, createMutation]);

  const handleAuthorize = useCallback((id: string) => {
    window.open(
      `/api/mcp-connectors/${id}/authorize`,
      "mcp-oauth",
      "width=600,height=700,popup=yes",
    );
  }, []);

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        className="w-[min(520px,92vw)] max-h-[80vh] flex flex-col border border-[rgba(255,255,255,0.1)] rounded-[20px] bg-[rgba(28,26,22,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.5)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <h2 className="text-[rgba(245,240,232,0.92)] text-[1.05rem] font-semibold m-0">
            MCP Connectors
          </h2>
          <button
            type="button"
            className="inline-grid h-8 w-8 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.065)] hover:text-[rgba(247,242,233,0.92)]"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Connector list */}
          {isLoading ? (
            <p className="text-[rgba(245,240,232,0.46)] text-[0.84rem]">Loading...</p>
          ) : connectors.length > 0 ? (
            <div className="mb-5">
              <div className="text-[rgba(245,240,232,0.38)] text-[0.68rem] font-semibold tracking-[0.18em] uppercase mb-2.5">
                Your connectors
              </div>
              <div className="flex flex-col gap-1">
                {connectors.map((connector) => (
                  <div
                    key={connector.id}
                    className={`flex items-center gap-3 rounded-[14px] px-3.5 py-3 transition-opacity duration-150 ${connector.status === "DISABLED" ? "opacity-50" : ""}`}
                  >
                    <ToggleSwitch
                      enabled={connector.status === "ACTIVE"}
                      onChange={(enabled) => toggleMutation.mutate({ id: connector.id, enabled })}
                    />
                    <StatusDot status={connector.status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[rgba(245,240,232,0.9)] text-[0.88rem] font-medium truncate">
                        {connector.name}
                      </div>
                      <div className="text-[rgba(245,240,232,0.38)] text-[0.76rem] truncate">
                        {connector.status === "ERROR" && connector.lastError
                          ? connector.lastError
                          : connector.url}
                      </div>
                    </div>
                    <span className="text-[rgba(245,240,232,0.42)] text-[0.72rem] shrink-0">
                      {statusLabel(connector.status)}
                    </span>
                    {connector.status === "NEEDS_AUTH" && (
                      <button
                        type="button"
                        className="shrink-0 rounded-[8px] border border-[rgba(255,255,255,0.12)] bg-transparent text-[rgba(212,176,112,0.9)] text-[0.76rem] cursor-pointer px-2.5 py-1 transition-[background] duration-[140ms] hover:bg-[rgba(255,255,255,0.05)]"
                        onClick={() => handleAuthorize(connector.id)}
                      >
                        Authorize
                      </button>
                    )}
                    <button
                      type="button"
                      className="shrink-0 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-transparent text-[rgba(242,196,178,0.7)] text-[0.76rem] cursor-pointer px-2.5 py-1 transition-[background,color] duration-[140ms] hover:bg-[rgba(255,100,80,0.08)] hover:text-[rgba(242,196,178,0.95)]"
                      onClick={() => deleteMutation.mutate(connector.id)}
                      disabled={deleteMutation.isPending}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Add form */}
          <div>
            <div className="text-[rgba(245,240,232,0.38)] text-[0.68rem] font-semibold tracking-[0.18em] uppercase mb-2.5">
              Add new connector
            </div>
            <div className="flex flex-col gap-2.5">
              <div>
                <label className="block text-[rgba(245,240,232,0.56)] text-[0.78rem] mb-1">Name</label>
                <input
                  type="text"
                  className="w-full rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[rgba(245,240,232,0.92)] text-[0.88rem] outline-none focus:border-[rgba(212,112,73,0.5)] transition-colors"
                  placeholder="e.g. context7"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[rgba(245,240,232,0.56)] text-[0.78rem] mb-1">URL</label>
                <input
                  type="url"
                  className="w-full rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[rgba(245,240,232,0.92)] text-[0.88rem] outline-none focus:border-[rgba(212,112,73,0.5)] transition-colors"
                  placeholder="https://mcp.example.com/mcp"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[rgba(245,240,232,0.56)] text-[0.78rem] mb-1">
                  Token <span className="text-[rgba(245,240,232,0.3)]">(optional)</span>
                </label>
                <input
                  type="password"
                  className="w-full rounded-[10px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[rgba(245,240,232,0.92)] text-[0.88rem] outline-none focus:border-[rgba(212,112,73,0.5)] transition-colors"
                  placeholder="Bearer token for authenticated servers"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>

              {formError && (
                <p className="text-[rgba(242,160,140,0.9)] text-[0.82rem] m-0">{formError}</p>
              )}

              <button
                type="button"
                className="self-start rounded-[10px] border-0 bg-[rgba(212,112,73,0.8)] text-[#fff8f0] text-[0.86rem] font-medium cursor-pointer px-4 py-2 transition-[background,transform] duration-[160ms] hover:bg-[rgba(212,112,73,0.95)] hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => void handleSubmit()}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Connecting..." : "Test & Connect"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
