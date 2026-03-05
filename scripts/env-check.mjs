#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const requiredCore = [
  "APP_URL",
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ENCRYPTION_KEY",
];

const requiredFullPlatform = [
  "E2B_API_KEY",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_SLUG",
  "GITHUB_STATE_SECRET",
  "RUNNER_EVENT_TOKEN",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
];

const optional = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2B_TEMPLATE",
  "E2B_TEMPLATE_ID",
  "ALLOW_INSECURE_USER_HEADER",
];

function isSet(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function printGroup(title, keys, required) {
  console.log(`\n${title}`);
  for (const key of keys) {
    const present = isSet(key);
    const marker = present ? "OK  " : required ? "MISS" : "OPT ";
    console.log(`- [${marker}] ${key}`);
  }
}

const missingCore = requiredCore.filter((key) => !isSet(key));
const missingFull = requiredFullPlatform.filter((key) => !isSet(key));

console.log("Environment Check");
printGroup("Core Required", requiredCore, true);
printGroup("Full Platform Required", requiredFullPlatform, true);
printGroup("Optional", optional, false);

if (missingCore.length > 0 || missingFull.length > 0) {
  console.error("\nMissing required environment variables:");
  for (const key of [...missingCore, ...missingFull]) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

console.log("\nAll required environment variables are present.");
