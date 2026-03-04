import crypto from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

interface GithubConfig {
  appId: string;
  privateKey: string;
  appSlug: string;
}

function getGithubConfig(): GithubConfig {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const appSlug = process.env.GITHUB_APP_SLUG;

  if (!appId || !privateKey || !appSlug) {
    throw new Error(
      "Missing GitHub App configuration (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG)",
    );
  }

  return { appId, privateKey, appSlug };
}

function getStateSecret() {
  const secret = process.env.GITHUB_STATE_SECRET;
  if (!secret) {
    throw new Error("Missing GITHUB_STATE_SECRET");
  }
  return secret;
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signPayload(payload: string): string {
  return crypto
    .createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("base64url");
}

export function createGithubInstallState(userId: string): string {
  const payload = JSON.stringify({
    userId,
    timestamp: Date.now(),
  });

  return encodeBase64Url(`${payload}.${signPayload(payload)}`);
}

export function parseGithubInstallState(state: string): { userId: string } {
  const raw = decodeBase64Url(state);
  const dotIndex = raw.lastIndexOf(".");

  if (dotIndex <= 0) {
    throw new Error("Invalid GitHub state payload");
  }

  const payload = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);

  if (signPayload(payload) !== signature) {
    throw new Error("Invalid GitHub state signature");
  }

  const parsed = JSON.parse(payload) as { userId?: string; timestamp?: number };

  if (!parsed.userId || !parsed.timestamp) {
    throw new Error("Invalid GitHub state body");
  }

  if (Date.now() - parsed.timestamp > 60 * 60 * 1000) {
    throw new Error("GitHub state expired");
  }

  return { userId: parsed.userId };
}

export function buildGithubInstallUrl(state: string): string {
  const { appSlug } = getGithubConfig();
  return `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}

async function createAppToken(): Promise<string> {
  const { appId, privateKey } = getGithubConfig();
  const auth = createAppAuth({ appId, privateKey });
  const authResult = await auth({ type: "app" });
  return authResult.token;
}

export async function createInstallationToken(
  installationId: string,
): Promise<string> {
  const { appId, privateKey } = getGithubConfig();
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId: Number(installationId),
  });
  const authResult = await auth({ type: "installation" });
  return authResult.token;
}

export async function getInstallationDetails(installationId: string) {
  const appToken = await createAppToken();
  const octokit = new Octokit({ auth: appToken });

  const installation = await octokit.request(
    "GET /app/installations/{installation_id}",
    {
      installation_id: Number(installationId),
    },
  );

  return installation.data;
}

export async function createInstallationOctokit(
  installationId: string,
): Promise<Octokit> {
  const token = await createInstallationToken(installationId);
  return new Octokit({ auth: token });
}
