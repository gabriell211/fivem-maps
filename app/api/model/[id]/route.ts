import { NextResponse } from "next/server";
import { getTripoJob, isTripoConfigured } from "@/lib/tripo";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isTripoConfigured()) {
    return NextResponse.json({ error: "Tripo não configurado." }, { status: 503 });
  }

  try {
    const { id } = await context.params;
    const job = await getTripoJob(id);
    return NextResponse.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      error: job.errorMessage,
      consumedCredit: job.consumedCredit,
      modelUrl: job.status === "success" ? job.modelUrl : undefined,
      previewUrl: job.status === "success" ? `/api/model/${encodeURIComponent(id)}/file` : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar geração 3D na Tripo.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
