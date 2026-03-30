import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveRunState } from "@/lib/chat-utils";
import type { RunDto } from "@/lib/contracts";

interface UseScrollManagerParams {
  liveRun: LiveRunState | null;
  runs: RunDto[];
  activeConversationId: string | null;
}

export function useScrollManager({ liveRun, runs, activeConversationId }: UseScrollManagerParams) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const latestRunRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const scrollRafRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const syncScrollShadows = useCallback(() => {
    const el = transcriptRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;

    // Cap scroll: keep at least 200px of the last run's actual content visible.
    // Uses the .run-thread element (not the min-height wrapper) to find the real content bottom.
    const lastRunWrapper = latestRunRef.current;
    if (lastRunWrapper) {
      const runThread = lastRunWrapper.querySelector(".run-thread") ?? lastRunWrapper;
      const containerTop = el.getBoundingClientRect().top;
      const contentBottom = runThread.getBoundingClientRect().bottom - containerTop + el.scrollTop;
      const maxScrollTop = contentBottom - 200;
      if (maxScrollTop > 0 && el.scrollTop > maxScrollTop) {
        el.scrollTop = maxScrollTop;
      }
    }

    const scrollTop = el.scrollTop;
    const scrollBottom = el.scrollHeight - el.clientHeight - scrollTop;
    stage.dataset.scrollTop = scrollTop > 8 ? "true" : "false";
    stage.dataset.scrollBottom = scrollBottom > 8 ? "true" : "false";
    // Show scroll-down only when actual message content extends below the footer
    if (footerRef.current && el) {
      const lastThread = el.querySelector(".run-thread:last-of-type");
      if (lastThread) {
        const contentBottom = lastThread.getBoundingClientRect().bottom;
        const footerTop = footerRef.current.getBoundingClientRect().top;
        setShowScrollDown(contentBottom > footerTop);
      } else {
        setShowScrollDown(false);
      }
    }
  }, []);

  // On new message send: scroll the latest user message to the top of the viewport
  // No auto-scroll during streaming — user controls their own scroll pace
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRun?.runId is intentionally more specific than liveRun — we only want to scroll when a NEW run starts, not on every streaming state change
  useEffect(() => {
    if (!liveRun) return;
    setShowScrollDown(false);
    // Cancel any pending scroll from a previous run
    cancelAnimationFrame(scrollRafRef.current);
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        if (latestRunRef.current && transcriptRef.current) {
          const container = transcriptRef.current;
          const el = latestRunRef.current;
          const containerRect = container.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const scrollTarget = elRect.top - containerRect.top + container.scrollTop - 16;
          container.scrollTo({ top: scrollTarget, behavior: "smooth" });
        }
        syncScrollShadows();
      });
      scrollRafRef.current = raf2;
    });
    scrollRafRef.current = raf1;
  }, [liveRun?.runId, syncScrollShadows]);

  // Recalculate scroll button visibility when content changes (e.g. after page refresh, data load)
  // Double rAF ensures DOM has painted the new content before measuring
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs, liveRun, activeConversationId are intentional triggers — hook params that signal content changes requiring scroll recalculation
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => syncScrollShadows()));
  }, [runs, liveRun, activeConversationId, syncScrollShadows]);

  const scrollToBottom = useCallback(() => {
    setShowScrollDown(false);
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  return {
    showScrollDown,
    setShowScrollDown,
    transcriptRef,
    stageRef,
    latestRunRef,
    footerRef,
    syncScrollShadows,
    scrollToBottom,
  };
}
