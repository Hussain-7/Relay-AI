#!/usr/bin/env node

import { query, type SDKMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// ── Parse CLI args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--") && i + 1 < args.length) {
      const key = arg.slice(2);
      parsed[key] = args[++i]!;
    }
  }

  if (!parsed.task) {
    console.error("Usage: relay-agent --task <task> [--cwd <dir>] [--resume <session-id>] [--model <model>]");
    process.exit(1);
  }

  return {
    task: parsed.task,
    cwd: parsed.cwd ?? process.cwd(),
    resume: parsed.resume,
    model: parsed.model ?? process.env.ANTHROPIC_CODING_MODEL ?? "claude-sonnet-4-6",
  };
}

// ── Output helpers ──
// Each line is a JSON object so the caller can parse events

function emitEvent(type: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ type, ts: new Date().toISOString(), ...data }));
}

// ── Permission handler — allow everything ──

async function allowAll(
  _toolName: string,
  _input: unknown,
  options: { toolUseID: string },
): Promise<PermissionResult> {
  return { behavior: "allow", toolUseID: options.toolUseID };
}

// ── Normalize SDK messages to structured output ──

function handleMessage(message: SDKMessage) {
  if (message.type === "system" && message.subtype === "init") {
    emitEvent("session.init", {
      sessionId: message.session_id,
      cwd: message.cwd,
    });
    return;
  }

  if (message.type === "stream_event") {
    const event = message.event;

    if (event.type === "content_block_start") {
      const block = event.content_block as unknown as Record<string, unknown>;
      if (block.type === "tool_use") {
        emitEvent("tool.start", {
          toolName: block.name,
          toolUseId: block.id,
        });
      }
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        process.stderr.write(event.delta.text);
        emitEvent("text.delta", { text: event.delta.text });
      }
      if (event.delta.type === "thinking_delta") {
        emitEvent("thinking.delta", { text: event.delta.thinking });
      }
    }
  }

  // Handle tool progress events
  const msgAny = message as unknown as Record<string, unknown>;
  if (msgAny.type === "tool_use") {
    emitEvent("tool.use", {
      toolName: msgAny.tool_name,
      input: msgAny.tool_input,
    });
  }

  if (msgAny.type === "tool_result") {
    emitEvent("tool.result", {
      toolName: msgAny.tool_name,
      output: String(msgAny.output ?? "").slice(0, 1000),
    });
  }

  if ("result" in message) {
    emitEvent("result", {
      result: message.result,
      sessionId: message.session_id,
    });
  }
}

// ── System prompt ──

const SYSTEM_PROMPT = `You are Relay AI's coding agent running inside a sandboxed workspace.

You have full access to the filesystem and shell. You can:
- Read, write, and edit files
- Run any shell command (git, npm, pip, etc.)
- Search code with grep/glob
- Browse the web for documentation

Guidelines:
- Inspect the repo structure before making changes
- Make small, focused edits
- Use git to commit your changes with clear messages
- If the task includes pushing, run git push
- Output a brief summary of what you did when finished

You are operating in a secure sandbox. All tools are pre-approved.`;

// ── Main ──

async function main() {
  const { task, cwd, resume, model } = parseArgs();

  emitEvent("agent.start", { task, cwd, model, resume: resume ?? null });

  try {
    const conversation = query({
      prompt: task,
      options: {
        cwd,
        resume,
        model,
        systemPrompt: SYSTEM_PROMPT,
        permissionMode: "default",
        tools: { type: "preset", preset: "claude_code" },
        allowedTools: [
          "Read", "Write", "Edit", "Glob", "Grep", "Bash",
          "WebSearch", "WebFetch", "Agent",
        ],
        canUseTool: allowAll,
        persistSession: true,
        thinking: { type: "enabled", budgetTokens: 4096 },
      },
    });

    let finalResult = "";
    let sessionId: string | null = null;

    for await (const message of conversation) {
      handleMessage(message);

      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }

      if ("result" in message) {
        finalResult = typeof message.result === "string"
          ? message.result
          : JSON.stringify(message.result);
      }
    }

    emitEvent("agent.done", {
      sessionId,
      resultLength: finalResult.length,
    });

    // Write final result summary to stderr for visibility
    process.stderr.write(`\n\n--- Agent completed ---\n${finalResult.slice(0, 500)}\n`);

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitEvent("agent.error", { error: message });
    process.stderr.write(`\nAgent error: ${message}\n`);
    process.exit(1);
  }
}

main();
