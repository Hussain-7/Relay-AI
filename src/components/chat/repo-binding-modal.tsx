"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useRepoBindings,
  useSearchGithubRepos,
  useConnectRepo,
  useGithubStatus,
  type RepoBindingListItem,
  type GithubRepoSearchResult,
} from "@/lib/api-hooks";
import { IconClose, IconSearch, IconGithub, IconChevron } from "@/components/icons";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 inline-block ml-1 opacity-50">
      <path d="M4 6V4a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1zm2-2a2 2 0 1 1 4 0v2H6V4z" fill="currentColor" />
    </svg>
  );
}

export function RepoBindingModal({
  onClose,
  onSelect,
  currentRepoBindingId,
}: {
  onClose: () => void;
  onSelect: (binding: RepoBindingListItem) => void;
  currentRepoBindingId: string | null;
}) {
  const { data: githubStatus } = useGithubStatus();
  const { data: repoData, isLoading } = useRepoBindings();
  const searchMutation = useSearchGithubRepos();
  const connectMutation = useConnectRepo();

  const availableRepos = repoData?.available ?? [];
  const bindings = repoData?.bindings ?? [];
  const connectedFullNames = useMemo(() => new Set(bindings.map((b) => b.repoFullName)), [bindings]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GithubRepoSearchResult[] | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [ownerDropdownOpen, setOwnerDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isGithubInstalled = githubStatus?.installed ?? false;

  // Extract unique owners from available repos
  const owners = useMemo(() => {
    const ownerSet = new Map<string, number>();
    for (const repo of availableRepos) {
      ownerSet.set(repo.owner, (ownerSet.get(repo.owner) ?? 0) + 1);
    }
    return Array.from(ownerSet.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [availableRepos]);

  // Set default owner on load
  useEffect(() => {
    if (owners.length > 0 && ownerFilter === null) {
      setOwnerFilter(owners[0]);
    }
  }, [owners, ownerFilter]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setSearchResults(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchMutation.mutate(value.trim(), {
        onSuccess: (repos) => setSearchResults(repos),
      });
    }, 400);
  }, [searchMutation]);

  const handleConnect = useCallback(async (repo: GithubRepoSearchResult) => {
    const binding = await connectMutation.mutateAsync(repo.fullName);
    onSelect(binding);
  }, [connectMutation, onSelect]);

  // All repos for selected owner (for count display)
  const ownerRepos = useMemo(() => {
    return availableRepos.filter((r) => !ownerFilter || r.owner === ownerFilter);
  }, [availableRepos, ownerFilter]);

  const filteredCount = ownerRepos.length;

  // Display repos: search results OR filtered available repos (top 5 by updated)
  const displayRepos = useMemo(() => {
    if (searchResults) return searchResults;

    return ownerRepos
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [searchResults, ownerRepos]);

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-[min(560px,92vw)] flex flex-col border border-[rgba(255,255,255,0.08)] rounded-[20px] bg-[rgba(30,28,24,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-[rgba(245,240,232,0.92)] text-[1rem] font-semibold m-0">
            Connect repository
          </h2>
          <button
            type="button"
            className="inline-grid h-7 w-7 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.4)] cursor-pointer rounded-[8px] transition-[background,color] duration-140 hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(247,242,233,0.8)]"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        {!isGithubInstalled ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 gap-3">
            <span className="text-[rgba(245,240,232,0.5)]"><IconGithub /></span>
            <span className="text-[rgba(245,240,232,0.5)] text-[0.88rem]">GitHub App not installed</span>
            <span className="text-[rgba(245,240,232,0.3)] text-[0.8rem] text-center">
              Install the GitHub App to connect repositories.
            </span>
            {githubStatus?.installUrl && (
              <a
                href={githubStatus.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 rounded-[10px] border-0 bg-[rgba(212,112,73,0.75)] text-[#fff8f0] text-[0.86rem] font-medium cursor-pointer py-2 px-5 no-underline transition-all duration-160 hover:bg-[rgba(212,112,73,0.92)]"
              >
                Install GitHub App
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Owner dropdown + Search bar */}
            <div className="flex items-stretch gap-2 mx-5 mb-3">
              {/* Owner selector */}
              <div className="relative" data-chat-action-menu>
                <button
                  type="button"
                  className="flex items-center gap-2 h-full rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 text-[rgba(245,240,232,0.85)] text-[0.84rem] cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.05)] whitespace-nowrap"
                  onClick={() => setOwnerDropdownOpen((v) => !v)}
                >
                  <IconGithub />
                  <span>{ownerFilter ?? "All"}</span>
                  <IconChevron />
                </button>
                {ownerDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 z-10 min-w-[180px] border border-[rgba(255,255,255,0.1)] rounded-[12px] bg-[rgba(38,36,32,0.98)] shadow-[0_12px_36px_rgba(0,0,0,0.5)] p-1 backdrop-blur-xl">
                    {owners.map((owner) => (
                      <button
                        key={owner}
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-[8px] border-0 bg-transparent text-[0.82rem] cursor-pointer px-3 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.06)] ${ownerFilter === owner ? "text-[rgba(245,240,232,0.92)]" : "text-[rgba(245,240,232,0.55)]"}`}
                        onClick={() => {
                          setOwnerFilter(owner);
                          setOwnerDropdownOpen(false);
                          setSearchQuery("");
                          setSearchResults(null);
                        }}
                      >
                        <IconGithub />
                        {owner}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Search */}
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-[rgba(245,240,232,0.5)] focus-within:border-[rgba(212,112,73,0.4)] transition-colors">
                <IconSearch />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="flex-1 border-0 bg-transparent text-[rgba(245,240,232,0.92)] text-[0.84rem] outline-none placeholder:text-[rgba(245,240,232,0.22)]"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
                {searchMutation.isPending && (
                  <svg className="h-4 w-4 shrink-0 animate-spin text-[rgba(245,240,232,0.35)]" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
              </div>
            </div>

            {/* Repo list */}
            <div className="overflow-y-auto px-5 pb-5 min-h-0 max-h-[50vh]">
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <span className="text-[rgba(245,240,232,0.3)] text-[0.84rem]">Loading repos...</span>
                </div>
              ) : displayRepos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-1.5">
                  <span className="text-[rgba(245,240,232,0.25)] text-[0.84rem]">
                    {isSearching ? "No matching repos" : "No repos found"}
                  </span>
                </div>
              ) : (
                <div className="border border-[rgba(255,255,255,0.06)] rounded-[12px] overflow-hidden divide-y divide-[rgba(255,255,255,0.06)]">
                  {displayRepos.map((repo) => {
                    const alreadyConnected = connectedFullNames.has(repo.fullName);
                    return (
                      <div
                        key={repo.fullName}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[rgba(255,255,255,0.02)]"
                      >
                        <span className="text-[rgba(245,240,232,0.3)] shrink-0"><IconGithub /></span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[rgba(245,240,232,0.88)] text-[0.86rem] font-medium">{repo.name}</span>
                          {repo.isPrivate && <LockIcon />}
                          <span className="text-[rgba(245,240,232,0.25)] text-[0.76rem] ml-2">{relativeTime(repo.updatedAt)}</span>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-[8px] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[rgba(245,240,232,0.8)] text-[0.8rem] font-medium cursor-pointer px-3.5 py-1.5 transition-all duration-140 hover:bg-[rgba(255,255,255,0.1)] hover:text-[rgba(245,240,232,0.95)] disabled:opacity-30 disabled:cursor-not-allowed"
                          onClick={() => void handleConnect(repo)}
                          disabled={alreadyConnected || connectMutation.isPending}
                        >
                          {alreadyConnected ? "Connected" : "Connect"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Show all link when not searching */}
              {!isSearching && filteredCount > 5 && (
                <div className="mt-2 text-center">
                  <span className="text-[rgba(245,240,232,0.25)] text-[0.76rem]">
                    Showing 5 of {filteredCount} repos. Search to find more.
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
