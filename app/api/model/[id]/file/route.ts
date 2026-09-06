import { getTripoJob, isTripoConfigured } from "@/lib/tripo";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isTripoConfigured()) return new Response("Tripo não configurado.", { status: 503 });

  try {
    const { id } = await context.params;
    const job = await getTripoJob(id);
    if (job.status !== "success" || !job.modelUrl) {
      return new Response("Modelo ainda não está pronto.", { status: 409 });
    }

    const upstream = await fetch(job.modelUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return new Response("Modelo gerado não pôde ser baixado da Tripo.", { status: 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "model/gltf-binary",
        "Cache-Control": "private, max-age=240",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar modelo Tripo.";
    return new Response(message, { status: 502 });
  }
}
