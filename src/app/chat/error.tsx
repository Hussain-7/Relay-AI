"use client";

import { useRouter } from "next/navigation";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--background, #262624)",
        color: "var(--foreground, #f1eee7)",
        fontFamily: "var(--font-primary-sans, system-ui), sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 500, marginBottom: 8 }}>
          Chat error
        </h2>
        <p style={{ fontSize: "0.9rem", opacity: 0.55, marginBottom: 24 }}>
          {error.message || "Something went wrong loading this conversation."}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              padding: "9px 20px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--foreground, #f1eee7)",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <button
            onClick={() => router.push("/chat/new")}
            style={{
              padding: "9px 20px",
              borderRadius: 8,
              border: "1px solid rgba(181,103,69,0.35)",
              background: "rgba(181,103,69,0.1)",
              color: "var(--foreground, #f1eee7)",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            New chat
          </button>
        </div>
      </div>
    </div>
  );
}
