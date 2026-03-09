"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { ModelCatalogDto } from "@/lib/contracts";
import { IconCheck } from "@/components/icons";

export function ComposerModelMenuPortal({
  anchor,
  models,
  selectedModelId,
  isUpdating,
  onSelect,
}: {
  anchor: HTMLElement | null;
  models: ModelCatalogDto["availableMainModels"];
  selectedModelId: string;
  isUpdating: boolean;
  onSelect: (modelId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !panelRef.current) return;

    const updatePosition = () => {
      if (!anchor || !panelRef.current) return;
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const width = Math.min(336, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);

      panel.style.width = `${width}px`;
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(12, rect.top - panel.offsetHeight - 10)}px`;
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, models.length]);

  return createPortal(
    <div
      className="fixed z-70 grid gap-0.5 border border-[rgba(255,255,255,0.12)] rounded-[22px] bg-[linear-gradient(180deg,rgba(65,63,58,0.98),rgba(53,51,47,0.98)),rgba(24,22,19,0.98)] p-2.5 shadow-[0_22px_60px_rgba(0,0,0,0.36)] backdrop-blur-[22px]"
      data-chat-action-menu
      ref={panelRef}
    >
      <div className="px-3 pt-2 pb-2.5 text-[rgba(245,240,232,0.46)] text-[0.68rem] font-semibold tracking-[0.18em] uppercase">Choose model</div>
      {models.map((model) => {
        const isSelected = selectedModelId === model.id;

        return (
          <button
            key={model.id}
            type="button"
            className={`flex w-full items-center justify-between gap-3 border-0 rounded-[18px] bg-transparent text-[rgba(245,240,232,0.86)] cursor-pointer px-4 py-3.5 text-left transition-[background,color] duration-[180ms] ease-linear hover:not-disabled:bg-[rgba(255,255,255,0.05)] disabled:opacity-60 disabled:cursor-not-allowed ${isSelected ? "bg-[rgba(255,255,255,0.05)]" : ""}`}
            onClick={() => onSelect(model.id)}
            disabled={isUpdating}
          >
            <span className="flex min-w-0 flex-auto flex-col gap-[3px]">
              <span className="text-[rgba(245,240,232,0.94)] text-[0.98rem] font-medium">{model.label}</span>
              <span className="text-[rgba(245,240,232,0.54)] text-[0.8rem] leading-[1.48] text-pretty">{model.description}</span>
            </span>
            {isSelected ? (
              <span className="inline-grid shrink-0 place-items-center text-[rgba(190,222,209,0.9)]" aria-hidden="true">
                <IconCheck />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
