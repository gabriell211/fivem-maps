import { getWorkerConfig } from "@/lib/worker";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const worker = getWorkerConfig();
  if (!worker) {
    return Response.json({ error: "MAP_FORGE_WORKER_URL não configurada." }, { status: 503 });
  }

  const { id } = await context.params;
  const response = await fetch(`${worker.url}/v1/exports/${encodeURIComponent(id)}/download`, {
    cache: "no-store",
    headers: worker.headers,
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    return Response.json({ error: text || "Arquivo ainda não disponível." }, { status: response.status || 502 });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="fivem-map-${id.slice(0, 8)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
