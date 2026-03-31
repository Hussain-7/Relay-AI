"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

/* ── Types ── */

interface AnalyticsData {
  period: { days: number; since: string };
  totals: {
    runs: number;
    conversations: number;
    messages: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
  daily: Array<{ day: string; runs: number; cost: number; tokens: number }>;
  models: Array<{ model: string; runs: number; costUsd: number; inputTokens: number; outputTokens: number }>;
  topConversations: Array<{ conversationId: string; title: string; runs: number; costUsd: number }>;
}

/* ── Helpers ── */

function formatCost(usd: number) {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatModelName(model: string | null) {
  if (!model) return "Unknown";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model.replace(/^claude-/, "");
}

const MODEL_COLORS: Record<string, string> = {
  opus: "#dd7148",
  sonnet: "#7aa894",
  haiku: "#c9a85c",
};

function getModelColor(model: string | null) {
  if (!model) return "#888";
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (model.includes(key)) return color;
  }
  return "#888";
}

/* ── Stat Card ── */

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
      <div className="text-[0.75rem] text-[rgba(245,240,232,0.4)] uppercase tracking-wider mb-2">{label}</div>
      <div className="text-[1.6rem] font-semibold text-[rgba(245,240,232,0.92)] tracking-tight leading-none">
        {value}
      </div>
      {sub && <div className="text-[0.78rem] text-[rgba(245,240,232,0.35)] mt-1.5">{sub}</div>}
    </div>
  );
}

/* ── Bar Chart (pure CSS) ── */

function BarChart({
  data,
  valueKey,
  label,
}: {
  data: AnalyticsData["daily"];
  valueKey: "cost" | "runs" | "tokens";
  label: string;
}) {
  if (!data.length)
    return <div className="text-[0.82rem] text-[rgba(245,240,232,0.3)] text-center py-12">No data yet</div>;

  const max = Math.max(...data.map((d) => d[valueKey]), 0.001);

  return (
    <div>
      <div className="text-[0.78rem] text-[rgba(245,240,232,0.45)] mb-4">{label}</div>
      <div className="flex items-end gap-[3px] h-[140px]">
        {data.map((d) => {
          const pct = (d[valueKey] / max) * 100;
          const dayLabel = new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          return (
            <div key={d.day} className="group relative flex-1 flex flex-col items-center justify-end h-full min-w-0">
              <div
                className="w-full rounded-t-[3px] bg-accent transition-all duration-200 group-hover:bg-accent/80 min-h-[2px]"
                style={{ height: `${Math.max(pct, 1.5)}%` }}
              />
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="rounded-lg bg-[rgba(30,28,24,0.98)] border border-[rgba(255,255,255,0.12)] px-3 py-2 text-[0.72rem] text-[rgba(245,240,232,0.82)] whitespace-nowrap shadow-lg">
                  <div className="font-medium">{dayLabel}</div>
                  <div className="text-[rgba(245,240,232,0.5)]">
                    {valueKey === "cost"
                      ? formatCost(d.cost)
                      : valueKey === "tokens"
                        ? formatTokens(d.tokens)
                        : `${d.runs} runs`}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* X-axis labels — show first, middle, last */}
      <div className="flex justify-between mt-2 text-[0.65rem] text-[rgba(245,240,232,0.25)]">
        <span>
          {data.length > 0
            ? new Date(data[0]!.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : ""}
        </span>
        <span>
          {data.length > 0
            ? new Date(data[data.length - 1]!.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : ""}
        </span>
      </div>
    </div>
  );
}

/* ── Model Donut (SVG) ── */

function ModelDonut({ models }: { models: AnalyticsData["models"] }) {
  const total = models.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  if (total === 0)
    return <div className="text-[0.82rem] text-[rgba(245,240,232,0.3)] text-center py-8">No model data</div>;

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-8">
      <svg width="130" height="130" viewBox="0 0 130 130" className="shrink-0">
        {models.map((m) => {
          const pct = (m.costUsd ?? 0) / total;
          const dashLen = pct * circumference;
          const dashOffset = -offset;
          offset += dashLen;
          return (
            <circle
              key={m.model}
              cx="65"
              cy="65"
              r={radius}
              fill="none"
              stroke={getModelColor(m.model)}
              strokeWidth="14"
              strokeDasharray={`${dashLen} ${circumference - dashLen}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              className="transition-all duration-500"
              style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
            />
          );
        })}
        <text
          x="65"
          y="62"
          textAnchor="middle"
          className="fill-[rgba(245,240,232,0.88)] text-[1rem] font-semibold"
          style={{ fontFamily: "inherit" }}
        >
          {formatCost(total)}
        </text>
        <text
          x="65"
          y="78"
          textAnchor="middle"
          className="fill-[rgba(245,240,232,0.35)] text-[0.6rem]"
          style={{ fontFamily: "inherit" }}
        >
          total
        </text>
      </svg>
      <div className="space-y-2.5">
        {models.map((m) => (
          <div key={m.model} className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: getModelColor(m.model) }} />
            <span className="text-[0.82rem] text-[rgba(245,240,232,0.7)]">{formatModelName(m.model)}</span>
            <span className="text-[0.75rem] text-[rgba(245,240,232,0.35)] ml-auto">
              {formatCost(m.costUsd)} &middot; {m.runs} runs
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Skeleton (matches real layout dimensions) ── */

function SkeletonPulse({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-[rgba(255,255,255,0.06)] ${className ?? ""}`} style={style} />;
}

function AnalyticsSkeleton() {
  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
            <SkeletonPulse className="h-3 w-20 mb-4" />
            <SkeletonPulse className="h-8 w-24 mb-2" />
            <SkeletonPulse className="h-3 w-28" />
          </div>
        ))}
      </div>

      {/* Chart cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
            <SkeletonPulse className="h-3 w-20 mb-6" />
            <div className="flex items-end gap-[3px] h-[140px]">
              {Array.from({ length: 12 }).map((_, j) => (
                <SkeletonPulse
                  key={j}
                  className="flex-1 min-w-0 rounded-t-[3px]"
                  style={{ height: `${20 + Math.random() * 60}%` } as React.CSSProperties}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2">
              <SkeletonPulse className="h-2.5 w-12" />
              <SkeletonPulse className="h-2.5 w-12" />
            </div>
          </div>
        ))}
      </div>

      {/* Model + Token cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
        {/* Donut placeholder */}
        <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
          <SkeletonPulse className="h-3 w-24 mb-6" />
          <div className="flex items-center gap-8">
            <SkeletonPulse className="h-[130px] w-[130px] shrink-0 !rounded-full" />
            <div className="space-y-3 flex-1">
              <SkeletonPulse className="h-3 w-32" />
              <SkeletonPulse className="h-3 w-24" />
            </div>
          </div>
        </div>
        {/* Token bars placeholder */}
        <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
          <SkeletonPulse className="h-3 w-28 mb-6" />
          <div className="space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="flex justify-between mb-1.5">
                  <SkeletonPulse className="h-3 w-16" />
                  <SkeletonPulse className="h-3 w-12" />
                </div>
                <SkeletonPulse className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top conversations placeholder */}
      <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
        <SkeletonPulse className="h-3 w-36 mb-5" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <SkeletonPulse className="h-3 w-4" />
              <SkeletonPulse className="h-3 flex-1 max-w-[200px]" />
              <SkeletonPulse className="h-3 w-14 ml-auto" />
              <SkeletonPulse className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Page ── */

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await api.get<AnalyticsData>(`/api/analytics?days=${d}`);
      setData(res);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(days);
  }, [days, fetchData]);

  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-[960px] px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <Link
              href="/chat/new"
              className="text-[0.78rem] text-[rgba(245,240,232,0.4)] no-underline hover:text-[rgba(245,240,232,0.7)] transition-colors"
            >
              &larr; Back to chat
            </Link>
            <h1 className="font-serif text-[1.8rem] leading-[1.15] tracking-[-0.02em] text-[rgba(245,240,232,0.92)] mt-2">
              Usage Analytics
            </h1>
          </div>
          {/* Period selector */}
          <div className="flex gap-1 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] p-0.5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-md px-3 py-1.5 text-[0.78rem] font-medium border-0 cursor-pointer transition-all duration-150 ${
                  days === d
                    ? "bg-[rgba(255,255,255,0.1)] text-[rgba(245,240,232,0.88)]"
                    : "bg-transparent text-[rgba(245,240,232,0.4)] hover:text-[rgba(245,240,232,0.65)]"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {loading && !data ? (
          <AnalyticsSkeleton />
        ) : data ? (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              <StatCard label="Total Cost" value={formatCost(data.totals.costUsd)} sub={`${days}-day period`} />
              <StatCard
                label="Agent Runs"
                value={String(data.totals.runs)}
                sub={`${data.totals.conversations} conversations`}
              />
              <StatCard label="Messages" value={String(data.totals.messages)} sub={`sent & received`} />
              <StatCard
                label="Tokens Used"
                value={formatTokens(data.totals.totalTokens)}
                sub={`${formatTokens(data.totals.inputTokens)} in / ${formatTokens(data.totals.outputTokens)} out`}
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
              {/* Daily cost chart */}
              <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
                <BarChart data={data.daily} valueKey="cost" label="Daily Cost" />
              </div>
              {/* Daily runs chart */}
              <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
                <BarChart data={data.daily} valueKey="runs" label="Daily Runs" />
              </div>
            </div>

            {/* Model breakdown + Top conversations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
              {/* Model donut */}
              <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
                <div className="text-[0.78rem] text-[rgba(245,240,232,0.45)] mb-4">Cost by Model</div>
                <ModelDonut models={data.models} />
              </div>

              {/* Token breakdown */}
              <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
                <div className="text-[0.78rem] text-[rgba(245,240,232,0.45)] mb-4">Token Breakdown</div>
                <div className="space-y-4">
                  {[
                    { label: "Input", value: data.totals.inputTokens, color: "#dd7148" },
                    { label: "Output", value: data.totals.outputTokens, color: "#7aa894" },
                    { label: "Cache Read", value: data.totals.cacheReadTokens, color: "#c9a85c" },
                    { label: "Cache Write", value: data.totals.cacheWriteTokens, color: "#8b7ec8" },
                  ].map((item) => {
                    const pct = data.totals.totalTokens > 0 ? (item.value / data.totals.totalTokens) * 100 : 0;
                    return (
                      <div key={item.label}>
                        <div className="flex justify-between mb-1">
                          <span className="text-[0.82rem] text-[rgba(245,240,232,0.65)]">{item.label}</span>
                          <span className="text-[0.78rem] text-[rgba(245,240,232,0.4)]">
                            {formatTokens(item.value)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(pct, 0.5)}%`, background: item.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Top conversations table */}
            {data.topConversations.length > 0 && (
              <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5">
                <div className="text-[0.78rem] text-[rgba(245,240,232,0.45)] mb-4">Top Conversations by Cost</div>
                <div className="space-y-1">
                  {data.topConversations.map((c, i) => (
                    <Link
                      key={c.conversationId}
                      href={`/chat/${c.conversationId}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 no-underline transition-colors hover:bg-[rgba(255,255,255,0.04)]"
                    >
                      <span className="text-[0.75rem] font-medium text-[rgba(245,240,232,0.3)] w-5 text-center">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-[0.84rem] text-[rgba(245,240,232,0.75)] truncate">{c.title}</span>
                      <span className="text-[0.78rem] text-[rgba(245,240,232,0.4)]">{c.runs} runs</span>
                      <span className="text-[0.78rem] font-medium text-accent">{formatCost(c.costUsd)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 text-[rgba(245,240,232,0.4)]">Failed to load analytics</div>
        )}
      </div>
    </div>
  );
}
