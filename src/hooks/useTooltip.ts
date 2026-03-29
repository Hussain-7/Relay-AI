import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface TooltipState {
  text: string;
  x: number;
  y: number;
}

/**
 * Manages a hover tooltip for anchor elements with title/data-title attributes.
 * Swaps `title` → `data-title` to suppress the native browser tooltip.
 */
export function useTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseOver = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest("a[title], a[data-title]") as HTMLAnchorElement | null;
    if (!anchor) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setTooltip(null), 100);
      return;
    }
    // Swap title → data-title to suppress native tooltip
    if (anchor.title) {
      anchor.setAttribute("data-title", anchor.title);
      anchor.removeAttribute("title");
    }
    const text = anchor.getAttribute("data-title");
    if (!text) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const rect = anchor.getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const handleMouseOut = useCallback((e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.("a[data-title]")) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setTooltip(null), 100);
  }, []);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return { tooltip, handleMouseOver, handleMouseOut };
}
