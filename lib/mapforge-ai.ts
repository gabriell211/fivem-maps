const DEFAULT_TIMEOUT_MS = 20_000;

export type MapForgeAIStatus = "pending" | "running" | "success" | "error";

export type MapForgeAIJob = {
  id: string;
  status: MapForgeAIStatus;
  progress: number;
  stage?: string;
  modelUrl?: string;
  errorMessage?: string;
};

type JobPayload = {
  id?: string;
  status?: string;
  progress?: number;
  stage?: string;
  model_url?: string;
  error?: string;
};

function baseUrl(): string | null {
  const value = process.env.MAP_FORGE_AI_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function token(): string | null {
  return process.env.MAP_FORGE_AI_TOKEN?.trim() || null;
}

export function isMapForgeAIConfigured(): boolean {
  return baseUrl() !== null;
}

function headers(json = false): HeadersInit {
  const result: Record<string, string> = {};
  if (json) result["Content-Type"] = "application/json";
  const secret = token();
  if (secret) result["X-Map-Forge-Token"] = secret;
  return result;
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string; error?: string };
    return payload.detail || payload.error || `Map Forge AI respondeu HTTP ${response.status}.`;
  } catch {
    return `Map Forge AI respondeu HTTP ${response.status}.`;
  }
}

function normalizeStatus(value: string | undefined): MapForgeAIStatus {
  if (value === "success" || value === "ready") return "success";
  if (value === "error" || value === "failed") return "error";
  if (value === "running" || value === "generating") return "running";
  return "pending";
}

function normalizeJob(payload: JobPayload): MapForgeAIJob {
  if (!payload.id) throw new Error("Map Forge AI retornou um job sem id.");
  const status = normalizeStatus(payload.status);
  return {
    id: payload.id,
    status,
    progress: status === "success" ? 100 : Math.max(0, Math.min(99, Math.round(payload.progress ?? 0))),
    ...(payload.stage ? { stage: payload.stage } : {}),
    ...(payload.model_url ? { modelUrl: payload.model_url } : {}),
    ...(payload.error ? { errorMessage: payload.error } : {}),
  };
}

export async function createMapForgeGeneration(prompt: string): Promise<MapForgeAIJob> {
  const url = baseUrl();
  if (!url) throw new Error("MAP_FORGE_AI_URL não configurada.");

  const response = await fetch(`${url}/v1/generations`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ prompt }),
    cache: "no-store",
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return normalizeJob(await response.json() as JobPayload);
}

export async function getMapForgeGeneration(jobId: string): Promise<MapForgeAIJob> {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(jobId)) throw new Error("Job ID inválido.");
  const url = baseUrl();
  if (!url) throw new Error("MAP_FORGE_AI_URL não configurada.");

  const response = await fetch(`${url}/v1/generations/${encodeURIComponent(jobId)}`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return normalizeJob(await response.json() as JobPayload);
}

export async function fetchMapForgeModel(jobId: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(jobId)) throw new Error("Job ID inválido.");
  const url = baseUrl();
  if (!url) throw new Error("MAP_FORGE_AI_URL não configurada.");

  return fetch(`${url}/v1/generations/${encodeURIComponent(jobId)}/model`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(180_000),
  });
}
