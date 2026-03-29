import type { ComponentProps } from "react";

const variants = {
  primary:
    "rounded-[10px] border-0 bg-[rgba(245,240,232,0.92)] text-[rgba(30,28,24,0.95)] text-[0.84rem] font-semibold cursor-pointer px-4 py-2 transition-all duration-140 hover:bg-[rgba(245,240,232,1)] disabled:opacity-40 disabled:cursor-not-allowed",
  secondary:
    "rounded-[10px] border border-[rgba(255,255,255,0.12)] bg-transparent text-[rgba(245,240,232,0.78)] text-[0.84rem] font-medium cursor-pointer px-4 py-2 transition-all duration-140 hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.92)]",
  ghost:
    "rounded-[8px] border-0 bg-transparent text-[rgba(245,240,232,0.6)] text-[0.82rem] cursor-pointer px-3 py-1.5 transition-colors duration-140 hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.85)]",
  danger:
    "rounded-[10px] border-0 bg-[rgba(220,60,60,0.8)] text-white text-[0.84rem] font-semibold cursor-pointer px-4 py-2 transition-all duration-140 hover:bg-[rgba(220,60,60,0.95)] disabled:opacity-40 disabled:cursor-not-allowed",
  accent:
    "rounded-[10px] border-0 bg-[rgba(212,112,73,0.75)] text-[#fff8f0] text-[0.84rem] font-semibold cursor-pointer px-4 py-2 transition-all duration-140 hover:bg-[rgba(212,112,73,0.9)] disabled:opacity-40 disabled:cursor-not-allowed",
  icon: "inline-grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-[rgba(245,240,232,0.4)] cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.7)]",
} as const;

type Variant = keyof typeof variants;

interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
}

export function Button({ variant = "secondary", className, ...props }: ButtonProps) {
  return <button type="button" className={className ?? variants[variant]} {...props} />;
}
