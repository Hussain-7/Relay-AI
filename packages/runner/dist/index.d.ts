#!/usr/bin/env node
type Executor = "claude" | "codex";
interface RunnerBootstrapOptions {
    runId: string;
    apiBaseUrl: string;
    eventToken: string;
    executor?: Executor;
    prompt?: string;
    workingDir?: string;
    maxMinutes?: number;
    repoFullName?: string;
    baseBranch?: string;
    workingBranch?: string;
}
export declare function describeRunnerBootstrap(options: RunnerBootstrapOptions): string;
export declare function runRunnerWithOptions(options: RunnerBootstrapOptions): Promise<void>;
export {};
