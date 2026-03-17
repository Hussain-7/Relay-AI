"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useMcpConnectors,
  useCreateMcpConnector,
  useDeleteMcpConnector,
  useToggleMcpConnector,
  queryKeys,
  type McpConnectorDto,
} from "@/lib/api-hooks";
import { IconClose, IconPlus } from "@/components/icons";
import { Toggle } from "@/components/ui/toggle";

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: McpConnectorDto["status"]) {
  switch (status) {
    case "ACTIVE": return "bg-emerald-400";
    case "NEEDS_AUTH": return "bg-amber-400";
    case "ERROR": return "bg-red-400";
    case "DISABLED": return "bg-[rgba(255,255,255,0.2)]";
  }
}

function statusText(status: McpConnectorDto["status"]) {
  switch (status) {
    case "ACTIVE": return "Connected";
    case "NEEDS_AUTH": return "Needs authorization";
    case "ERROR": return "Error";
    case "DISABLED": return "Disabled";
  }
}

function truncateUrl(url: string, max = 52) {
  return url.length > max ? url.slice(0, max - 1) + "\u2026" : url;
}

// ── Connector Card ──────────────────────────────────────────────────────────

function ConnectorCard({
  connector,
  onToggle,
  onAuthorize,
  onRemove,
  isRemoving,
}: {
  connector: McpConnectorDto;
  onToggle: (enabled: boolean) => void;
  onAuthorize: () => void;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className={`group relative rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3.5 py-2.5 transition-all duration-150`}>
      <div className="flex items-start gap-3">
        {/* Toggle */}
        <div className="pt-0.5">
          <Toggle
            size="small"
            enabled={connector.status === "ACTIVE"}
            onChange={onToggle}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[rgba(245,240,232,0.92)] text-[0.9rem] font-medium truncate">
              {connector.name}
            </span>
            <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${statusColor(connector.status)}`} />
            <span className="text-[rgba(245,240,232,0.36)] text-[0.7rem] shrink-0">
              {statusText(connector.status)}
            </span>
          </div>
          <div className="text-[rgba(245,240,232,0.3)] text-[0.76rem] mt-0.5 truncate">
            {connector.status === "ERROR" && connector.lastError
              ? connector.lastError
              : truncateUrl(connector.url)}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {connector.status === "NEEDS_AUTH" && (
            <button
              type="button"
              className="rounded-[8px] border-0 bg-[rgba(212,176,112,0.12)] text-[rgba(228,196,132,0.95)] text-[0.74rem] font-medium cursor-pointer px-2.5 py-1.5 transition-all duration-140 hover:bg-[rgba(212,176,112,0.2)]"
              onClick={onAuthorize}
            >
              Authorize
            </button>
          )}

          {confirmRemove ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[14px] bg-[rgba(25,23,20,0.92)] backdrop-blur-[6px]">
              <span className="text-[rgba(245,240,232,0.5)] text-[0.74rem]">Remove?</span>
              <button
                type="button"
                className="rounded-[6px] border-0 bg-[rgba(220,80,60,0.18)] text-[rgba(255,150,130,0.95)] text-[0.72rem]! font-medium cursor-pointer px-2 py-1 transition-all duration-140 hover:bg-[rgba(220,80,60,0.3)]"
                onClick={onRemove}
                disabled={isRemoving}
              >
                {isRemoving ? "Removing\u2026" : "Yes"}
              </button>
              <button
                type="button"
                className="rounded-[6px] border-0 bg-[rgba(255,255,255,0.05)] text-[rgba(245,240,232,0.45)] text-[0.72rem]! cursor-pointer px-2 py-1 transition-all duration-140 hover:bg-[rgba(255,255,255,0.09)] hover:text-[rgba(245,240,232,0.7)]"
                onClick={() => setConfirmRemove(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label="Remove connector"
              className="inline-grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-[rgba(245,240,232,0.2)] cursor-pointer opacity-0 group-hover:opacity-100 transition-all duration-140 hover:text-[rgba(255,140,120,0.8)] hover:bg-[rgba(255,100,80,0.06)]"
              onClick={() => setConfirmRemove(true)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5">
                <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7h10Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Form ────────────────────────────────────────────────────────────────

function AddConnectorForm({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const createMutation = useCreateMcpConnector();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!name.trim() || !url.trim()) {
      setError("Name and URL are required");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        url: url.trim(),
        authorizationToken: token.trim() || undefined,
      });

      if (result.needsAuth) {
        window.open(
          `/api/mcp-connectors/${result.connector.id}/authorize`,
          "mcp-oauth",
          "width=600,height=700,popup=yes",
        );
      }

      setName("");
      setUrl("");
      setToken("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    }
  }, [name, url, token, createMutation, onCreated]);

  return (
    <div className="flex flex-col h-full">
      {/* Back header */}
      <div className="flex items-center gap-2 mb-5">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 border-0 bg-transparent text-[rgba(245,240,232,0.5)] text-[0.82rem] cursor-pointer px-0 transition-colors duration-140 hover:text-[rgba(245,240,232,0.8)]"
          onClick={onBack}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5">
            <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
      </div>

      <div className="flex flex-col gap-3.5">
        <div>
          <label className="block text-[rgba(245,240,232,0.52)] text-[0.76rem] font-medium mb-1.5">
            Display name
          </label>
          <input
            type="text"
            className="w-full rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3.5 py-2.5 text-[rgba(245,240,232,0.92)] text-[0.88rem] outline-none placeholder:text-[rgba(245,240,232,0.22)] focus:border-[rgba(212,112,73,0.4)] transition-colors"
            placeholder="e.g. Context7"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[rgba(245,240,232,0.52)] text-[0.76rem] font-medium mb-1.5">
            Server URL
          </label>
          <input
            type="url"
            className="w-full rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3.5 py-2.5 text-[rgba(245,240,232,0.92)] text-[0.88rem] outline-none placeholder:text-[rgba(245,240,232,0.22)] focus:border-[rgba(212,112,73,0.4)] transition-colors font-mono text-[0.82rem]"
            placeholder="https://mcp.example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-[rgba(245,240,232,0.52)] text-[0.76rem] font-medium mb-1.5">
            Authorization token
            <span className="text-[rgba(245,240,232,0.22)] font-normal ml-1.5">optional</span>
          </label>
          <input
            type="password"
            className="w-full rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3.5 py-2.5 text-[rgba(245,240,232,0.92)] text-[0.88rem] outline-none placeholder:text-[rgba(245,240,232,0.22)] focus:border-[rgba(212,112,73,0.4)] transition-colors"
            placeholder="For pre-authenticated servers"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="text-[rgba(245,240,232,0.25)] text-[0.72rem] mt-1.5 m-0">
            Leave empty for open servers or OAuth-protected servers.
          </p>
        </div>

        {error && (
          <div className="rounded-[8px] bg-[rgba(220,80,60,0.08)] border border-[rgba(220,80,60,0.15)] px-3 py-2">
            <p className="text-[rgba(255,160,140,0.9)] text-[0.8rem] m-0">{error}</p>
          </div>
        )}

        <button
          type="button"
          className="self-stretch rounded-[10px] border-0 bg-[rgba(212,112,73,0.75)] text-[#fff8f0] text-[0.88rem] font-medium cursor-pointer py-2.5 transition-all duration-[160ms] hover:bg-[rgba(212,112,73,0.92)] disabled:opacity-45 disabled:cursor-not-allowed mt-1"
          onClick={() => void handleSubmit()}
          disabled={createMutation.isPending || !name.trim() || !url.trim()}
        >
          {createMutation.isPending ? "Connecting..." : "Connect"}
        </button>
      </div>
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

export function McpConnectorModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: connectors = [], isLoading } = useMcpConnectors();
  const deleteMutation = useDeleteMcpConnector();
  const toggleMutation = useToggleMcpConnector();

  const [view, setView] = useState<"list" | "add">("list");
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Listen for OAuth popup messages
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

  const handleAuthorize = useCallback((id: string) => {
    setOauthError(null);
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
        className="w-[min(480px,92vw)] max-h-[80vh] flex flex-col border border-[rgba(255,255,255,0.08)] rounded-[20px] bg-[rgba(30,28,24,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3.5">
          <h2 className="text-[rgba(245,240,232,0.92)] text-[1rem] font-semibold m-0">
            Connectors
          </h2>
          <button
            type="button"
            className="inline-grid h-7 w-7 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.4)] cursor-pointer rounded-[8px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(247,242,233,0.8)]"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {view === "add" ? (
            <AddConnectorForm
              onBack={() => setView("list")}
              onCreated={() => setView("list")}
            />
          ) : (
            <>
              {/* Add button */}
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-[rgba(255,255,255,0.1)] bg-transparent text-[rgba(245,240,232,0.5)] text-[0.84rem] cursor-pointer py-3 mb-3 transition-all duration-150 hover:border-[rgba(212,112,73,0.35)] hover:text-[rgba(245,240,232,0.75)] hover:bg-[rgba(212,112,73,0.04)]"
                onClick={() => setView("add")}
              >
                <span className="inline-grid place-items-center"><IconPlus /></span>
                Add new connector
              </button>

              {/* OAuth error banner */}
              {oauthError && (
                <div className="rounded-[8px] bg-[rgba(220,80,60,0.08)] border border-[rgba(220,80,60,0.15)] px-3 py-2 mb-3">
                  <p className="text-[rgba(255,160,140,0.9)] text-[0.8rem] m-0">{oauthError}</p>
                </div>
              )}

              {/* Connector list */}
              {isLoading ? (
                <div className="flex flex-col gap-1.5">
                  {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3.5 py-2.5 animate-pulse">
                      <div className="flex items-start gap-3">
                        <span className="h-[18px] w-[32px] rounded-full bg-[rgba(255,255,255,0.06)] shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-3.5 rounded bg-[rgba(255,255,255,0.06)]" style={{ width: `${80 + (i * 30) % 60}px` }} />
                            <span className="h-1.5 w-1.5 rounded-full bg-[rgba(255,255,255,0.06)]" />
                            <span className="h-2.5 w-14 rounded bg-[rgba(255,255,255,0.04)]" />
                          </div>
                          <span className="block h-2.5 w-40 rounded bg-[rgba(255,255,255,0.04)] mt-1.5" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : connectors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <span className="text-[rgba(245,240,232,0.22)] text-[0.84rem]">No connectors yet</span>
                  <span className="text-[rgba(245,240,232,0.16)] text-[0.76rem]">
                    Add an MCP server to give the agent extra tools
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {connectors.map((connector) => (
                    <ConnectorCard
                      key={connector.id}
                      connector={connector}
                      onToggle={(enabled) => toggleMutation.mutate({ id: connector.id, enabled })}
                      onAuthorize={() => handleAuthorize(connector.id)}
                      onRemove={() => deleteMutation.mutate(connector.id)}
                      isRemoving={deleteMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
