import { type ComponentProps, forwardRef } from "react";

const BASE =
  "w-full rounded-[10px] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3.5 py-2.5 text-[0.9rem] text-[rgba(245,240,232,0.92)] outline-none transition-colors focus:border-[rgba(255,255,255,0.25)] placeholder:text-[rgba(245,240,232,0.25)]";

const COMPACT =
  "w-full rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[0.82rem] text-[rgba(245,240,232,0.88)] outline-none transition-colors focus:border-[rgba(255,255,255,0.2)] placeholder:text-[rgba(245,240,232,0.25)]";

const variants = { default: BASE, compact: COMPACT } as const;
type Variant = keyof typeof variants;

interface InputProps extends ComponentProps<"input"> {
  variant?: Variant;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ variant = "default", className, ...props }, ref) => {
  return <input ref={ref} className={className ?? variants[variant]} {...props} />;
});

Input.displayName = "Input";
