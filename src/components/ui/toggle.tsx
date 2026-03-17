export function Toggle({
  enabled,
  onChange,
  size = "default",
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  size?: "small" | "default";
}) {
  const isSmall = size === "small";
  const trackH = isSmall ? "h-[18px]" : "h-[20px]";
  const trackW = isSmall ? "w-[32px]" : "w-[36px]";
  const thumbSize = isSmall ? "h-[14px] w-[14px]" : "h-[16px] w-[16px]";
  const thumbOn = isSmall ? "translate-x-[16px]" : "translate-x-[18px]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex ${trackH} ${trackW} shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-150 ${enabled ? "bg-[rgba(212,112,73,0.7)]" : "bg-[rgba(255,255,255,0.12)]"}`}
      onClick={() => onChange(!enabled)}
    >
      <span
        className={`pointer-events-none inline-block ${thumbSize} rounded-full bg-white shadow-sm transition-transform duration-150 translate-y-[2px] ${enabled ? thumbOn : "translate-x-[2px]"}`}
      />
    </button>
  );
}
