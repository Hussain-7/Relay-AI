/**
 * Build the E2B custom sandbox template for the Relay AI coding agent.
 *
 * Usage:
 *   cd packages/coding-agent
 *   pnpm build:template
 *
 * Prerequisites:
 *   - E2B_API_KEY set in environment or in root .env/.env.local
 *   - The coding agent CLI built (dist/cli.js exists)
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from root .env and .env.local
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(__dirname, "../../.env.local"), override: true });

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    console.error("E2B_API_KEY not found. Set it in .env or .env.local");
    process.exit(1);
  }

  console.log("Building E2B template: relay-coding-agent...\n");

  const cliSource = readFileSync(resolve(__dirname, "dist/cli.js"), "utf-8");
  const packageJson = readFileSync(resolve(__dirname, "package.json"), "utf-8");

  console.log("1. Creating sandbox from base template...");
  const sandbox = await Sandbox.create("code-interpreter-v1", {
    apiKey,
    timeoutMs: 1000 * 60 * 10,
  });

  console.log(`   Sandbox ID: ${sandbox.sandboxId}`);

  const run = (cmd: string, opts?: { timeoutMs?: number }) =>
    sandbox.commands.run(cmd, { user: "root", ...opts });

  console.log("2. Installing system dependencies...");
  await run("apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*", {
    timeoutMs: 60000,
  });

  console.log("3. Uploading coding agent CLI...");
  await run("mkdir -p /opt/relay-agent/dist");
  await sandbox.files.write("/opt/relay-agent/package.json", packageJson);
  await sandbox.files.write("/opt/relay-agent/dist/cli.js", `#!/usr/bin/env node\n${cliSource}`);

  console.log("4. Installing agent dependencies...");
  await run("cd /opt/relay-agent && npm install --production", {
    timeoutMs: 60000,
  });

  console.log("5. Linking CLI binary...");
  await run("chmod +x /opt/relay-agent/dist/cli.js");
  await run("ln -sf /opt/relay-agent/dist/cli.js /usr/local/bin/relay-agent");

  console.log("6. Creating workspace directory...");
  await run("mkdir -p /workspace && chmod 777 /workspace");

  console.log("7. Verifying installation...");
  const verify = await run("relay-agent 2>&1 || true");
  console.log(`   ${verify.stderr.slice(0, 100)}`);

  console.log(`\n✓ Sandbox configured: ${sandbox.sandboxId}`);
  console.log(`\nTo save as a template, use the E2B CLI:`);
  console.log(`  e2b template create --from-sandbox ${sandbox.sandboxId} --name relay-coding-agent`);
  console.log(`\nThen update your .env with the template ID:`);
  console.log(`  E2B_TEMPLATE_ID="<template-id-from-above>"`);

  // Keep sandbox alive for template creation
  await sandbox.setTimeout(1000 * 60 * 30);
  console.log(`\nSandbox will stay alive for 30 minutes for template creation.`);
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
