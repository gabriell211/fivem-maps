import { NextResponse } from "next/server";
import { planScene } from "@/lib/planner";
import { createMapForgeGeneration, isMapForgeAIConfigured } from "@/lib/mapforge-ai";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("prompt" in body) || typeof body.prompt !== "string") {
      return NextResponse.json({ error: "Campo prompt é obrigatório." }, { status: 400 });
    }

    const prompt = body.prompt.trim();
    if (prompt.length < 8) {
      return NextResponse.json({ error: "Descreva o mapa com um pouco mais de detalhe." }, { status: 400 });
    }

    const scene = planScene(prompt);

    if (!isMapForgeAIConfigured()) {
      scene.sourceModel = {
        provider: "mapforge",
        jobId: `unconfigured-${scene.id.replace(/-/g, "").slice(0, 24)}`,
        status: "error",
        progress: 0,
        error: "Map Forge AI ainda não está conectado. Configure MAP_FORGE_AI_URL no servidor web.",
      };
    } else {
      try {
        const job = await createMapForgeGeneration(scene.prompt);
        scene.sourceModel = {
          provider: "mapforge",
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          ...(job.stage ? { stage: job.stage } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao iniciar o Map Forge AI.";
        scene.sourceModel = {
          provider: "mapforge",
          jobId: `failed-${scene.id.replace(/-/g, "").slice(0, 24)}`,
          status: "error",
          progress: 0,
          error: message,
        };
      }
    }

    return NextResponse.json({
      job: {
        id: scene.sourceModel.jobId,
        status: scene.sourceModel.status,
        progress: scene.sourceModel.progress ?? 0,
        provider: scene.sourceModel.provider,
      },
      scene,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar o mapa.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
