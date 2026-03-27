import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Relay AI — AI workspace for chat, research, and coding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(145deg, #1e1d1b, #16150f)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Spark icon */}
      <svg viewBox="0 0 24 24" width="72" height="72" style={{ marginBottom: 24 }}>
        <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="#DD7148" />
        <path
          d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z"
          fill="#DD7148"
          transform="rotate(45 12 12)"
          opacity="0.6"
        />
      </svg>
      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          color: "rgba(245, 240, 232, 0.95)",
          letterSpacing: "-0.03em",
          marginBottom: 12,
        }}
      >
        Relay AI
      </div>
      <div
        style={{
          fontSize: 24,
          color: "rgba(245, 240, 232, 0.5)",
          maxWidth: 600,
          textAlign: "center",
          lineHeight: 1.4,
        }}
      >
        Chat, research, image generation, and remote coding sessions — powered by Claude
      </div>
      {/* Feature pills */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 36,
        }}
      >
        {["AI Chat", "Deep Research", "Code Execution", "Image Generation", "GitHub Integration"].map((label) => (
          <div
            key={label}
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              color: "rgba(245, 240, 232, 0.6)",
              fontSize: 16,
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>,
    { ...size },
  );
}
