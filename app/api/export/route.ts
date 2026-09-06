import { NextResponse } from "next/server";
import { parseSceneSpec } from "@/lib/scene-schema";
import { getWorkerConfig } from "@/lib/worker";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const worker = getWorkerConfig();
  if (!worker) {
    return NextResponse.json({ error: "MAP_FORGE_WORKER_URL não configurada." }, { status: 503 });
  }

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("scene" in body)) {
      return NextResponse.json({ error: "SceneSpec ausente." }, { status: 400 });
    }

    const scene = parseSceneSpec(body.scene);
    if (scene.sourceModel && (scene.sourceModel.status === "pending" || scene.sourceModel.status === "running")) {
      return NextResponse.json({ error: "O modelo 3D ainda está sendo gerado." }, { status: 409 });
    }

    const response = await fetch(`${worker.url}/v1/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...worker.headers },
      body: JSON.stringify({ scene }),
      cache: "no-store",
    });

    const payload: unknown = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar job de exportação.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
