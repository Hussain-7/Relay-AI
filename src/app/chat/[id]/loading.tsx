export default function ChatLoading() {
  return (
    <div
      style={{
        height: "100dvh",
        display: "grid",
        gridTemplateColumns: "287.5px 1fr",
        background: "var(--background, #262624)",
        overflow: "hidden",
      }}
    >
      {/* Sidebar skeleton */}
      <div
        style={{
          background: "var(--sidebar, #232321)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={shimmerBar(32, "60%")} />
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={shimmerBar(28, `${70 + Math.sin(i) * 20}%`)} />
          ))}
        </div>
      </div>

      {/* Main area skeleton */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "15vh",
          gap: 16,
        }}
      >
        {/* Message bubbles */}
        <div style={{ width: "min(680px, 90%)", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ alignSelf: "flex-end", ...shimmerBar(20, 220) }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={shimmerBar(16, "85%")} />
            <div style={shimmerBar(16, "72%")} />
            <div style={shimmerBar(16, "40%")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function shimmerBar(height: number, width: number | string): React.CSSProperties {
  return {
    height,
    width,
    borderRadius: 6,
    background: "rgba(255,255,255,0.04)",
  };
}
