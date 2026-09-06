import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const workerUrl = process.env.MAP_FORGE_WORKER_URL?.replace(/\/$/, "");
  if (!workerUrl) {
    return NextResponse.json({ error: "MAP_FORGE_WORKER_URL não configurada." }, { status: 503 });
  }

  const { id } = await context.params;
  const response = await fetch(`${workerUrl}/v1/exports/${encodeURIComponent(id)}`, { cache: "no-store" });
  const payload: unknown = await response.json();

  if (response.ok && payload && typeof payload === "object" && "status" in payload && payload.status === "ready") {
    return NextResponse.json({ ...payload, downloadUrl: `/api/export/${encodeURIComponent(id)}/download` });
  }

  return NextResponse.json(payload, { status: response.status });
}
