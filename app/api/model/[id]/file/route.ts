import { fetchMapForgeModel, getMapForgeGeneration, isMapForgeAIConfigured } from "@/lib/mapforge-ai";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isMapForgeAIConfigured()) return new Response("Map Forge AI não configurado.", { status: 503 });

  try {
    const { id } = await context.params;
    const job = await getMapForgeGeneration(id);
    if (job.status !== "success") {
      return new Response("Modelo ainda não está pronto.", { status: 409 });
    }

    const upstream = await fetchMapForgeModel(id);
    if (!upstream.ok || !upstream.body) {
      return new Response("O modelo final não pôde ser baixado do Map Forge AI.", { status: 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "model/gltf-binary",
        "Content-Length": upstream.headers.get("content-length") ?? "",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar modelo do Map Forge AI.";
    return new Response(message, { status: 502 });
  }
}
