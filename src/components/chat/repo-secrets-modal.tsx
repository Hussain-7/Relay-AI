"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useRepoSecrets,
  useSaveRepoSecrets,
  useDeleteRepoSecret,
  type RepoSecretDto,
} from "@/lib/api-hooks";
import { IconClose, IconPlus } from "@/components/icons";

// ── Helpers ──────────────────────────────────────────────────────────────────

const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface SecretRow {
  id?: string; // existing secret ID (undefined for new rows)
  key: string;
  value: string;
  isExisting: boolean; // loaded from server (value is masked)
}

function parseEnvContent(text: string): { key: string; value: string }[] {
  const results: { key: string; value: string }[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) results.push({ key, value });
  }
  return results;
}

function buildRowsFromSecrets(secrets: RepoSecretDto[]): SecretRow[] {
  return secrets.map((s) => ({ id: s.id, key: s.key, value: "", isExisting: true }));
}

// ── Trash Icon ───────────────────────────────────────────────────────────────

function IconTrash() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6h12Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Secret Row Component ─────────────────────────────────────────────────────

function SecretRowInput({
  row,
  index,
  onChange,
  onRemove,
  onPasteMultiLine,
}: {
  row: SecretRow;
  index: number;
  onChange: (index: number, field: "key" | "value", val: string) => void;
  onRemove: (index: number) => void;
  onPasteMultiLine: (index: number, entries: { key: string; value: string }[]) => void;
}) {
  const [showValue, setShowValue] = useState(false);
  const [editing, setEditing] = useState(!row.isExisting);
  const maskedAndUntouched = row.isExisting && !row.value && !editing;

  const handleKeyPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text/plain");
      if (text.includes("\n") && text.includes("=")) {
        e.preventDefault();
        const entries = parseEnvContent(text);
        if (entries.length > 0) {
          onPasteMultiLine(index, entries);
        }
      }
    },
    [index, onPasteMultiLine],
  );

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={row.key}
        onChange={(e) => onChange(index, "key", e.target.value)}
        onPaste={handleKeyPaste}
        placeholder="KEY_NAME"
        spellCheck={false}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        className="flex-1 min-w-0 rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[0.82rem] text-[rgba(245,240,232,0.9)] placeholder:text-[rgba(245,240,232,0.25)] font-mono outline-none focus:border-[rgba(255,255,255,0.18)] transition-colors"
      />
      <div className="flex-1 min-w-0 relative">
        {maskedAndUntouched ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full text-left rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[0.82rem] font-mono cursor-text transition-colors hover:border-[rgba(255,255,255,0.18)]"
          >
            <span className="text-[rgba(245,240,232,0.35)]">••••••••</span>
            <span className="ml-2 text-[0.68rem] text-[rgba(245,240,232,0.2)]">click to replace</span>
          </button>
        ) : (
          <>
            <input
              type="text"
              value={row.value}
              onChange={(e) => onChange(index, "value", e.target.value)}
              placeholder={row.isExisting ? "enter new value" : "value"}
              autoFocus={row.isExisting && editing}
              spellCheck={false}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              style={showValue ? undefined : { WebkitTextSecurity: "disc" } as React.CSSProperties}
              className="w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 pr-8 text-[0.82rem] text-[rgba(245,240,232,0.9)] placeholder:text-[rgba(245,240,232,0.25)] font-mono outline-none focus:border-[rgba(255,255,255,0.18)] transition-colors"
            />
            {row.value && (
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-[rgba(245,240,232,0.3)] hover:text-[rgba(245,240,232,0.6)] transition-colors border-0 bg-transparent cursor-pointer"
                aria-label={showValue ? "Hide value" : "Show value"}
              >
                {showValue ? <IconEyeOff /> : <IconEye />}
              </button>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border-0 bg-transparent text-[rgba(245,240,232,0.3)] cursor-pointer transition-colors hover:text-red-400 hover:bg-[rgba(255,60,60,0.08)]"
        aria-label="Remove"
      >
        <IconTrash />
      </button>
    </div>
  );
}

// ── Main Modal ───────────────────────────────────────────────────────────────

export function RepoSecretsModal({
  repoBindingId,
  repoName,
  onClose,
}: {
  repoBindingId: string;
  repoName: string;
  onClose: () => void;
}) {
  const { data: existingSecrets, isLoading } = useRepoSecrets(repoBindingId);
  const saveMutation = useSaveRepoSecrets();
  const deleteMutation = useDeleteRepoSecret();

  const [rows, setRows] = useState<SecretRow[]>([{ key: "", value: "", isExisting: false }]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive rows from server data until the user starts editing
  const displayRows = useMemo(() => {
    if (!dirty && existingSecrets) {
      return existingSecrets.length > 0
        ? buildRowsFromSecrets(existingSecrets)
        : [{ key: "", value: "", isExisting: false } as SecretRow];
    }
    return rows;
  }, [dirty, existingSecrets, rows]);

  const updateRows = useCallback((updater: (prev: SecretRow[]) => SecretRow[]) => {
    if (!dirty) {
      // First user edit — seed state from server data then apply updater
      const base = existingSecrets && existingSecrets.length > 0
        ? buildRowsFromSecrets(existingSecrets)
        : [{ key: "", value: "", isExisting: false } as SecretRow];
      setRows(updater(base));
      setDirty(true);
    } else {
      setRows(updater);
    }
  }, [dirty, existingSecrets]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleChange = useCallback((index: number, field: "key" | "value", val: string) => {
    updateRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: val } : r)));
    setError(null);
  }, [updateRows]);

  const handleRemove = useCallback(
    (index: number) => {
      const row = displayRows[index];
      if (row?.id) {
        deleteMutation.mutate({ repoBindingId, secretId: row.id });
      }
      updateRows((prev) => {
        const next = prev.filter((_, i) => i !== index);
        return next.length > 0 ? next : [{ key: "", value: "", isExisting: false }];
      });
    },
    [displayRows, repoBindingId, deleteMutation, updateRows],
  );

  const handlePasteMultiLine = useCallback((index: number, entries: { key: string; value: string }[]) => {
    updateRows((prev) => {
      const before = prev.slice(0, index);
      const after = prev.slice(index + 1);
      const newRows: SecretRow[] = entries.map((e) => ({
        key: e.key,
        value: e.value,
        isExisting: false,
      }));
      return [...before, ...newRows, ...after];
    });
    setError(null);
  }, [updateRows]);

  const handleAddRow = useCallback(() => {
    updateRows((prev) => [...prev, { key: "", value: "", isExisting: false }]);
  }, [updateRows]);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const entries = parseEnvContent(text);
      if (entries.length > 0) {
        updateRows((prev) => {
          const newRows: SecretRow[] = entries.map((entry) => ({
            key: entry.key,
            value: entry.value,
            isExisting: false,
          }));
          const importKeys = new Set(entries.map((e) => e.key));
          const kept = prev.filter((r) => r.isExisting && !importKeys.has(r.key));
          return [...kept, ...newRows];
        });
        setError(null);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [updateRows]);

  const handleSave = useCallback(() => {
    const toSave = displayRows.filter((r) => r.key.trim() !== "");

    // Validate
    const seenKeys = new Set<string>();
    for (const r of toSave) {
      if (!KEY_REGEX.test(r.key)) {
        setError(`Invalid key: "${r.key}". Use letters, numbers, and underscores.`);
        return;
      }
      if (seenKeys.has(r.key)) {
        setError(`Duplicate key: "${r.key}".`);
        return;
      }
      seenKeys.add(r.key);
    }

    const secrets = toSave.map((r) => ({ key: r.key, value: r.value }));
    saveMutation.mutate(
      { repoBindingId, secrets },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(err instanceof Error ? err.message : "Save failed."),
      },
    );
  }, [displayRows, repoBindingId, saveMutation, onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-[560px] mx-4 max-h-[85vh] flex flex-col rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[rgba(30,28,24,0.98)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[1rem] font-semibold text-[rgba(245,240,232,0.92)] m-0">Environment Variables</h2>
            <span className="text-[0.75rem] text-[rgba(245,240,232,0.4)] font-mono">{repoName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent text-[rgba(245,240,232,0.4)] cursor-pointer transition-colors hover:text-[rgba(245,240,232,0.8)] hover:bg-[rgba(255,255,255,0.06)]"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>

        {/* Column labels */}
        <div className="flex items-center gap-2 px-5 pb-2">
          <span className="flex-1 text-[0.7rem] uppercase tracking-wider text-[rgba(245,240,232,0.3)] font-medium">Key</span>
          <span className="flex-1 text-[0.7rem] uppercase tracking-wider text-[rgba(245,240,232,0.3)] font-medium">Value</span>
          <span className="w-7 shrink-0" />
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto px-5 space-y-2 min-h-0">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <div className="flex-1 h-[34px] rounded-[8px] bg-[rgba(255,255,255,0.04)] animate-pulse" />
                  <div className="flex-1 h-[34px] rounded-[8px] bg-[rgba(255,255,255,0.04)] animate-pulse" />
                  <div className="w-7 h-7 shrink-0 rounded-[6px] bg-[rgba(255,255,255,0.03)] animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            displayRows.map((row, i) => (
              <SecretRowInput
                key={row.id ?? `new-${i}`}
                row={row}
                index={i}
                onChange={handleChange}
                onRemove={handleRemove}
                onPasteMultiLine={handlePasteMultiLine}
              />
            ))
          )}

          {/* Add another */}
          <button
            type="button"
            onClick={handleAddRow}
            className="w-full flex items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[rgba(255,255,255,0.1)] bg-transparent px-3 py-2 text-[0.78rem] text-[rgba(245,240,232,0.4)] cursor-pointer transition-colors hover:border-[rgba(255,255,255,0.2)] hover:text-[rgba(245,240,232,0.6)] hover:bg-[rgba(255,255,255,0.02)]"
          >
            <IconPlus />
            Add another
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-5 pt-2 text-[0.78rem] text-red-400">{error}</div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[rgba(255,255,255,0.06)] mt-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-transparent px-3 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.6)] cursor-pointer transition-colors hover:border-[rgba(255,255,255,0.2)] hover:text-[rgba(245,240,232,0.8)]"
            >
              <IconUpload />
              Import .env
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".env,.env.*,.txt"
              className="hidden"
              onChange={handleImportFile}
            />
            <span className="text-[0.7rem] text-[rgba(245,240,232,0.25)]">or paste .env in Key input</span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="rounded-[8px] border-0 bg-[rgba(243,163,120,0.9)] px-5 py-1.5 text-[0.82rem] font-medium text-[rgba(30,28,24,0.95)] cursor-pointer transition-all hover:bg-[rgba(243,163,120,1)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
