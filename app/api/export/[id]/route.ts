import { NextResponse } from "next/server";
import { getWorkerConfig } from "@/lib/worker";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const worker = getWorkerConfig();
  if (!worker) {
    return NextResponse.json({ error: "MAP_FORGE_WORKER_URL não configurada." }, { status: 503 });
  }

  const { id } = await context.params;
  const response = await fetch(`${worker.url}/v1/exports/${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: worker.headers,
  });
  const payload: unknown = await response.json();

  if (response.ok && payload && typeof payload === "object" && "status" in payload && payload.status === "ready") {
    return NextResponse.json({ ...payload, downloadUrl: `/api/export/${encodeURIComponent(id)}/download` });
  }

  return NextResponse.json(payload, { status: response.status });
}
