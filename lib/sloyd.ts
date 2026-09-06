const SLOYD_BASE_URL = "https://api.sloyd.ai/api";

export type SloydStatus = "pending" | "running" | "success" | "error";

export type SloydJob = {
  id: string;
  status: SloydStatus;
  errorMessage?: string;
};

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SLOYD_CLIENT_ID?.trim();
  const clientSecret = process.env.SLOYD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isSloydConfigured(): boolean {
  return credentials() !== null;
}

function headers(): HeadersInit {
  const auth = credentials();
  if (!auth) throw new Error("Sloyd não configurado no servidor.");
  return {
    "Content-Type": "application/json",
    "x-client-id": auth.clientId,
    "x-client-secret": auth.clientSecret,
  };
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object") {
      if ("message" in payload && typeof payload.message === "string") return payload.message;
      if ("error" in payload && typeof payload.error === "string") return payload.error;
    }
  } catch {
    // Preserve the HTTP fallback below.
  }
  return `Sloyd respondeu HTTP ${response.status}.`;
}

export async function createSloydTextTo3D(prompt: string): Promise<{ jobId: string }> {
  const response = await fetch(`${SLOYD_BASE_URL}/jobs/text-to-3d`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt: prompt.slice(0, 4096),
      topology: "triangles",
      targetFaceCount: 50000,
      textureResolution: "1k",
      apiVersion: 1,
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(await parseError(response));
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("jobId" in payload) || typeof payload.jobId !== "string") {
    throw new Error("Sloyd não retornou um jobId válido.");
  }
  return { jobId: payload.jobId };
}

function normalizeStatus(value: unknown): SloydStatus {
  if (value === "success" || value === "completed") return "success";
  if (value === "error" || value === "failed") return "error";
  if (value === "running") return "running";
  return "pending";
}

export async function getSloydJob(jobId: string): Promise<SloydJob> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) throw new Error("jobId inválido.");

  const response = await fetch(`${SLOYD_BASE_URL}/jobs/${encodeURIComponent(jobId)}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await parseError(response));

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("Resposta inválida do Sloyd.");

  const status = normalizeStatus("status" in payload ? payload.status : undefined);
  const errorMessage = "errorMessage" in payload && typeof payload.errorMessage === "string"
    ? payload.errorMessage
    : undefined;

  return errorMessage ? { id: jobId, status, errorMessage } : { id: jobId, status };
}

export function getSloydModelUrl(jobId: string): string {
  return `https://storage.googleapis.com/ai-services-quality/jobs/${encodeURIComponent(jobId)}.glb`;
}
