const SLOYD_BASE_URL = "https://api.sloyd.ai/api";

export type SloydStatus = "pending" | "running" | "success" | "error";
export type SloydTextureResolution = "1k" | "2k" | "4k";

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

function textureResolution(): SloydTextureResolution {
  const value = process.env.SLOYD_TEXTURE_RESOLUTION?.trim().toLowerCase();
  return value === "1k" || value === "4k" ? value : "2k";
}

function targetFaceCount(): number {
  const parsed = Number.parseInt(process.env.SLOYD_TARGET_FACE_COUNT ?? "120000", 10);
  if (!Number.isFinite(parsed)) return 120000;
  return Math.max(20_000, Math.min(parsed, 450_000));
}

export async function createSloydTextTo3D(prompt: string): Promise<{ jobId: string }> {
  const productionPrompt = [
    prompt.trim(),
    "Create a game-ready realistic GTA V / FiveM environment asset.",
    "Fully textured exterior and requested visible interior details, clean UV mapping, realistic materials, architectural proportions, doors and windows with believable depth.",
    "No floating geometry, no presentation pedestal, no text labels, no people, no vehicles unless explicitly requested.",
  ].join(" ").slice(0, 4096);

  const response = await fetch(`${SLOYD_BASE_URL}/jobs/text-to-3d`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt: productionPrompt,
      topology: "triangles",
      targetFaceCount: targetFaceCount(),
      textureResolution: textureResolution(),
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
