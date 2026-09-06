import { NextResponse } from "next/server";
import { getMapForgeGeneration, isMapForgeAIConfigured } from "@/lib/mapforge-ai";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isMapForgeAIConfigured()) {
    return NextResponse.json({ error: "Map Forge AI não configurado." }, { status: 503 });
  }

  try {
    const { id } = await context.params;
    const job = await getMapForgeGeneration(id);
    return NextResponse.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.errorMessage,
      modelUrl: job.status === "success" ? job.modelUrl : undefined,
      previewUrl: job.status === "success" ? `/api/model/${encodeURIComponent(id)}/file` : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar Map Forge AI.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
