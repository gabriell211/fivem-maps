import { NextResponse } from "next/server";
import { getSloydJob, getSloydModelUrl, isSloydConfigured } from "@/lib/sloyd";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isSloydConfigured()) {
    return NextResponse.json({ error: "Sloyd não configurado." }, { status: 503 });
  }

  try {
    const { id } = await context.params;
    const job = await getSloydJob(id);
    return NextResponse.json({
      id: job.id,
      status: job.status,
      error: job.errorMessage,
      modelUrl: job.status === "success" ? getSloydModelUrl(id) : undefined,
      previewUrl: job.status === "success" ? `/api/model/${encodeURIComponent(id)}/file` : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar geração 3D.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
