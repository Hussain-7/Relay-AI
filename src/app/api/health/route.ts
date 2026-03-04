import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "endless-dev",
    timestamp: new Date().toISOString(),
  });
}
