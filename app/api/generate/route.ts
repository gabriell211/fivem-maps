import { NextResponse } from "next/server";
import { planScene } from "@/lib/planner";
import { createTripoTextTo3D, isTripoConfigured } from "@/lib/tripo";

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

    if (!isTripoConfigured()) {
      scene.sourceModel = {
        provider: "tripo",
        jobId: `unconfigured-${scene.id.replace(/-/g, "").slice(0, 24)}`,
        status: "error",
        progress: 0,
        error: "Tripo não configurado. Defina TRIPO_API_KEY no ambiente do servidor.",
      };
    } else {
      try {
        const { jobId } = await createTripoTextTo3D(scene.prompt);
        scene.sourceModel = {
          provider: "tripo",
          jobId,
          status: "pending",
          progress: 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao iniciar geração 3D na Tripo.";
        scene.sourceModel = {
          provider: "tripo",
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
