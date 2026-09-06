import { NextResponse } from "next/server";
import { planScene } from "@/lib/planner";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("prompt" in body) || typeof body.prompt !== "string") {
      return NextResponse.json({ error: "Campo prompt é obrigatório." }, { status: 400 });
    }

    const scene = planScene(body.prompt);
    return NextResponse.json({
      job: {
        id: scene.id,
        status: "preview",
        progress: 45,
      },
      scene,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar o mapa.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
