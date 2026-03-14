"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  useRepoBindings,
  useSearchGithubRepos,
  useConnectRepo,
  useDeleteRepoBinding,
  useGithubStatus,
  type RepoBindingListItem,
} from "@/lib/api-hooks";
import { IconClose, IconSearch, IconGithub } from "@/components/icons";

function RepoCard({
  binding,
  isLinked,
  onSelect,
  onRemove,
  isRemoving,
}: {
  binding: RepoBindingListItem;
  isLinked: boolean;
  onSelect: () => void;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className={`group relative rounded-[14px] border px-4 py-3.5 transition-all duration-150 hover:border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.03)] ${isLinked ? "border-[rgba(212,112,73,0.3)] bg-[rgba(212,112,73,0.04)]" : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"}`}>
      <div className="flex items-center gap-3">
        <span className="text-[rgba(245,240,232,0.4)]">
          <IconGithub />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[rgba(245,240,232,0.92)] text-[0.88rem] font-medium truncate">
            {binding.repoFullName}
          </div>
          {binding.defaultBranch && (
            <div className="text-[rgba(245,240,232,0.3)] text-[0.74rem] mt-0.5">
              {binding.defaultBranch}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            className={`rounded-[8px] border-0 text-[0.76rem] font-medium cursor-pointer px-2.5 py-1.5 transition-all duration-140 ${isLinked ? "bg-[rgba(212,112,73,0.15)] text-[rgba(228,170,132,0.95)] hover:bg-[rgba(212,112,73,0.25)]" : "bg-[rgba(255,255,255,0.06)] text-[rgba(245,240,232,0.6)] hover:bg-[rgba(255,255,255,0.1)] hover:text-[rgba(245,240,232,0.85)]"}`}
            onClick={onSelect}
          >
            {isLinked ? "Linked" : "Select"}
          </button>

          {confirmRemove ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[14px] bg-[rgba(25,23,20,0.92)] backdrop-blur-[6px]">
              <span className="text-[rgba(245,240,232,0.5)] text-[0.74rem]">Disconnect?</span>
              <button
                type="button"
                className="rounded-[6px] border-0 bg-[rgba(220,80,60,0.18)] text-[rgba(255,150,130,0.95)] text-[0.72rem] font-medium cursor-pointer px-2 py-1 transition-all duration-140 hover:bg-[rgba(220,80,60,0.3)]"
                onClick={onRemove}
                disabled={isRemoving}
              >
                {isRemoving ? "Removing\u2026" : "Yes"}
              </button>
              <button
                type="button"
                className="rounded-[6px] border-0 bg-[rgba(255,255,255,0.05)] text-[rgba(245,240,232,0.45)] text-[0.72rem] cursor-pointer px-2 py-1 transition-all duration-140 hover:bg-[rgba(255,255,255,0.09)] hover:text-[rgba(245,240,232,0.7)]"
                onClick={() => setConfirmRemove(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label="Disconnect repo"
              className="inline-grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-[rgba(245,240,232,0.2)] cursor-pointer opacity-0 group-hover:opacity-100 transition-all duration-140 hover:text-[rgba(255,140,120,0.8)] hover:bg-[rgba(255,100,80,0.06)]"
              onClick={() => setConfirmRemove(true)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5">
                <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7h10Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
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
  const { data: bindings = [], isLoading } = useRepoBindings();
  const searchMutation = useSearchGithubRepos();
  const connectMutation = useConnectRepo();
  const deleteMutation = useDeleteRepoBinding();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ fullName: string; name: string; defaultBranch: string; isPrivate: boolean; description: string | null }> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isGithubInstalled = githubStatus?.installed ?? false;

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
    }, 350);
  }, [searchMutation]);

  const handleConnect = useCallback(async (repoFullName: string) => {
    const binding = await connectMutation.mutateAsync(repoFullName);
    onSelect(binding);
  }, [connectMutation, onSelect]);

  const isAlreadyConnected = useCallback((fullName: string) => {
    return bindings.some((b) => b.repoFullName === fullName);
  }, [bindings]);

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-[4px]"
      onClick={onClose}
    >
      <div
        className="w-[min(480px,92vw)] max-h-[80vh] flex flex-col border border-[rgba(255,255,255,0.08)] rounded-[20px] bg-[rgba(30,28,24,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3.5">
          <h2 className="text-[rgba(245,240,232,0.92)] text-[1rem] font-semibold m-0">
            Connect repository
          </h2>
          <button
            type="button"
            className="inline-grid h-7 w-7 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.4)] cursor-pointer rounded-[8px] transition-[background,color] duration-[140ms] ease-linear hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(247,242,233,0.8)]"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        {!isGithubInstalled ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 gap-3">
            <span className="text-[rgba(245,240,232,0.5)]"><IconGithub /></span>
            <span className="text-[rgba(245,240,232,0.5)] text-[0.88rem]">
              GitHub App not installed
            </span>
            <span className="text-[rgba(245,240,232,0.3)] text-[0.8rem] text-center">
              Install the GitHub App to connect repositories.
            </span>
            {githubStatus?.installUrl && (
              <a
                href={githubStatus.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 rounded-[10px] border-0 bg-[rgba(212,112,73,0.75)] text-[#fff8f0] text-[0.86rem] font-medium cursor-pointer py-2 px-5 no-underline transition-all duration-[160ms] hover:bg-[rgba(212,112,73,0.92)]"
              >
                Install GitHub App
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Search bar */}
            <div className="flex items-center gap-2.5 mx-5 mb-3 px-3.5 py-2.5 rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-[rgba(245,240,232,0.5)] focus-within:border-[rgba(212,112,73,0.4)] transition-colors">
              <IconSearch />
              <input
                ref={searchInputRef}
                type="text"
                className="flex-1 border-0 bg-transparent text-[rgba(245,240,232,0.92)] text-[0.88rem] outline-none placeholder:text-[rgba(245,240,232,0.22)]"
                placeholder="Search GitHub repos\u2026"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              {searchMutation.isPending && (
                <span className="text-[rgba(245,240,232,0.3)] text-[0.74rem]">Searching\u2026</span>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {/* Search results */}
              {searchResults && searchResults.length > 0 && (
                <div className="mb-4">
                  <div className="text-[rgba(245,240,232,0.36)] text-[0.72rem] font-medium uppercase tracking-wider mb-2 px-1">
                    Search results
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {searchResults.map((repo) => {
                      const connected = isAlreadyConnected(repo.fullName);
                      return (
                        <button
                          key={repo.fullName}
                          type="button"
                          className={`flex items-center gap-3 w-full rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-left cursor-pointer transition-all duration-150 hover:border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.03)] disabled:opacity-40 disabled:cursor-not-allowed`}
                          onClick={() => void handleConnect(repo.fullName)}
                          disabled={connected || connectMutation.isPending}
                        >
                          <span className="text-[rgba(245,240,232,0.4)]"><IconGithub /></span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[rgba(245,240,232,0.88)] text-[0.86rem] truncate">{repo.fullName}</div>
                            {repo.description && (
                              <div className="text-[rgba(245,240,232,0.3)] text-[0.74rem] truncate mt-0.5">{repo.description}</div>
                            )}
                          </div>
                          <span className="text-[rgba(245,240,232,0.4)] text-[0.74rem] shrink-0">
                            {connected ? "Connected" : repo.isPrivate ? "Private" : "Public"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {searchResults && searchResults.length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 mb-4">
                  <span className="text-[rgba(245,240,232,0.3)] text-[0.84rem]">No repos found</span>
                </div>
              )}

              {/* Connected repos */}
              <div className="text-[rgba(245,240,232,0.36)] text-[0.72rem] font-medium uppercase tracking-wider mb-2 px-1">
                Connected repos
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <span className="text-[rgba(245,240,232,0.3)] text-[0.84rem]">Loading\u2026</span>
                </div>
              ) : bindings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <span className="text-[rgba(245,240,232,0.22)] text-[0.84rem]">No repos connected</span>
                  <span className="text-[rgba(245,240,232,0.16)] text-[0.76rem]">
                    Search above to find and connect a repository
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {bindings.map((binding) => (
                    <RepoCard
                      key={binding.id}
                      binding={binding}
                      isLinked={binding.id === currentRepoBindingId}
                      onSelect={() => onSelect(binding)}
                      onRemove={() => deleteMutation.mutate(binding.id)}
                      isRemoving={deleteMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
