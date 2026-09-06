import { getSloydJob, getSloydModelUrl, isSloydConfigured } from "@/lib/sloyd";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSloydConfigured()) return new Response("Sloyd não configurado.", { status: 503 });

  try {
    const { id } = await context.params;
    const job = await getSloydJob(id);
    if (job.status !== "success") return new Response("Modelo ainda não está pronto.", { status: 409 });

    const upstream = await fetch(getSloydModelUrl(id), { cache: "force-cache" });
    if (!upstream.ok || !upstream.body) {
      return new Response("Modelo gerado não pôde ser baixado.", { status: 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "model/gltf-binary",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar modelo.";
    return new Response(message, { status: 502 });
  }
}
