import { NextRequest, NextResponse } from "next/server";
import { resolveAuthContext } from "@/lib/auth-context";
import {
  buildGithubInstallUrl,
  createGithubInstallState,
} from "@/lib/github-app";
import { errorResponse } from "@/lib/http";

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);
    const state = createGithubInstallState(auth.userId);
    const installUrl = buildGithubInstallUrl(state);

    return NextResponse.json({ installUrl, state });
  } catch (error) {
    return errorResponse(error);
  }
}
