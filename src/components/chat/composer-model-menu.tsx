"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { ModelCatalogDto } from "@/lib/contracts";
import { IconCheck } from "@/components/icons";
import { Toggle as ToggleSwitch } from "@/components/ui/toggle";

export interface AgentPreferences {
  thinking: boolean;
  effort: "low" | "medium" | "high";
  memory: boolean;
}

export function ComposerModelMenuPortal({
  anchor,
  models,
  selectedModelId,
  isUpdating,
  onSelect,
  preferences,
  onPreferencesChange,
}: {
  anchor: HTMLElement | null;
  models: ModelCatalogDto["availableMainModels"];
  selectedModelId: string;
  isUpdating: boolean;
  onSelect: (modelId: string) => void;
  preferences: AgentPreferences;
  onPreferencesChange: (prefs: AgentPreferences) => void;
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
      className="fixed z-70 grid gap-0.5 border border-[rgba(255,255,255,0.12)] rounded-[18px] bg-[linear-gradient(180deg,rgba(65,63,58,0.98),rgba(53,51,47,0.98)),rgba(24,22,19,0.98)] p-2 shadow-[0_16px_48px_rgba(0,0,0,0.36)] backdrop-blur-[22px]"
      data-chat-action-menu
      ref={panelRef}
    >
      <div className="px-3 pt-1.5 pb-2 text-[rgba(245,240,232,0.4)] text-[0.66rem] font-semibold tracking-[0.16em] uppercase">Choose model</div>
      {models.map((model) => {
        const isSelected = selectedModelId === model.id;

        return (
          <button
            key={model.id}
            type="button"
            className={`flex w-full items-center justify-between gap-3 border-0 rounded-[12px] bg-transparent text-[rgba(245,240,232,0.86)] cursor-pointer px-3 py-2.5 text-left transition-[background,color] duration-[180ms] ease-linear hover:not-disabled:bg-[rgba(255,255,255,0.05)] disabled:opacity-60 disabled:cursor-not-allowed ${isSelected ? "bg-[rgba(255,255,255,0.05)]" : ""}`}
            onClick={() => onSelect(model.id)}
            disabled={isUpdating}
          >
            <span className="flex min-w-0 flex-auto flex-col gap-[3px]">
              <span className="text-[rgba(245,240,232,0.94)] text-[0.88rem] font-medium">{model.label}</span>
              <span className="text-[rgba(245,240,232,0.48)] text-[0.76rem] leading-[1.4] text-pretty">{model.description}</span>
            </span>
            {isSelected ? (
              <span className="inline-grid shrink-0 place-items-center text-[rgba(190,222,209,0.9)]" aria-hidden="true">
                <IconCheck />
              </span>
            ) : null}
          </button>
        );
      })}

      <div className="mt-1 pt-2 border-t border-[rgba(255,255,255,0.06)] px-3 pb-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[rgba(245,240,232,0.86)] text-[0.8rem] font-medium">Extended Thinking</span>
            <span className="text-[rgba(245,240,232,0.4)] text-[0.72rem]">Adaptive reasoning depth</span>
          </div>
          <ToggleSwitch enabled={preferences.thinking} onChange={(v) => onPreferencesChange({ ...preferences, thinking: v })} />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[rgba(245,240,232,0.86)] text-[0.8rem] font-medium">Effort</span>
            <span className="text-[rgba(245,240,232,0.4)] text-[0.72rem]">Response thoroughness</span>
          </div>
          <div className="flex gap-1">
            {(["low", "medium", "high"] as const).map((level) => (
              <button
                key={level}
                type="button"
                className={`px-2 py-0.5 text-[0.7rem] rounded-[6px] border-0 cursor-pointer transition-all duration-140 ${
                  preferences.effort === level
                    ? "bg-[rgba(212,112,73,0.25)] text-[rgba(245,220,200,0.95)]"
                    : "bg-[rgba(255,255,255,0.06)] text-[rgba(245,240,232,0.5)] hover:bg-[rgba(255,255,255,0.1)]"
                }`}
                onClick={() => onPreferencesChange({ ...preferences, effort: level })}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[rgba(245,240,232,0.86)] text-[0.8rem] font-medium">Memory</span>
            <span className="text-[rgba(245,240,232,0.4)] text-[0.72rem]">Persist workspace context</span>
          </div>
          <ToggleSwitch enabled={preferences.memory} onChange={(v) => onPreferencesChange({ ...preferences, memory: v })} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
