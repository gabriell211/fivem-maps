import { NextResponse } from "next/server";
import { planScene } from "@/lib/planner";
import { createSloydTextTo3D, isSloydConfigured } from "@/lib/sloyd";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("prompt" in body) || typeof body.prompt !== "string") {
      return NextResponse.json({ error: "Campo prompt é obrigatório." }, { status: 400 });
    }

    const scene = planScene(body.prompt);

    if (!isSloydConfigured()) {
      scene.sourceModel = {
        provider: "sloyd",
        jobId: `unconfigured-${scene.id.replace(/-/g, "").slice(0, 24)}`,
        status: "error",
        error: "Motor text-to-3D não configurado. Defina SLOYD_CLIENT_ID e SLOYD_CLIENT_SECRET no servidor.",
      };
    } else {
      try {
        const { jobId } = await createSloydTextTo3D(scene.prompt);
        scene.sourceModel = {
          provider: "sloyd",
          jobId,
          status: "pending",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao iniciar geração 3D.";
        scene.sourceModel = {
          provider: "sloyd",
          jobId: `failed-${scene.id.replace(/-/g, "").slice(0, 24)}`,
          status: "error",
          error: message,
        };
      }
    }

    return NextResponse.json({
      job: {
        id: scene.sourceModel.jobId,
        status: scene.sourceModel.status,
        progress: scene.sourceModel.status === "pending" ? 20 : 0,
        provider: scene.sourceModel.provider,
      },
      scene,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar o mapa.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
