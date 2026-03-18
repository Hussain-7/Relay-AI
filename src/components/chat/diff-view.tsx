"use client";

export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");

  return (
    <div className="max-h-[400px] overflow-auto rounded-[12px] bg-[rgba(8,8,8,0.5)] border border-[rgba(255,255,255,0.08)] text-[0.75rem] leading-[1.55] font-mono">
      {lines.map((line, i) => {
        let className = "text-[rgba(255,255,255,0.55)]"; // default context line
        let bgClassName = "";

        if (line.startsWith("+++") || line.startsWith("---")) {
          className = "text-[rgba(255,255,255,0.35)]";
        } else if (line.startsWith("diff --git")) {
          className = "text-[rgba(255,255,255,0.35)] font-semibold";
        } else if (line.startsWith("@@")) {
          className = "text-[rgba(180,160,220,0.8)]";
          bgClassName = "bg-[rgba(180,160,220,0.06)]";
        } else if (line.startsWith("+")) {
          className = "text-[rgba(120,200,140,0.9)]";
          bgClassName = "bg-[rgba(120,200,140,0.06)]";
        } else if (line.startsWith("-")) {
          className = "text-[rgba(220,120,120,0.9)]";
          bgClassName = "bg-[rgba(220,120,120,0.06)]";
        }

        return (
          <div
            key={i}
            className={`px-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${className} ${bgClassName}`}
          >
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}
