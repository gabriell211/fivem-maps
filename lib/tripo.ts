const TRIPO_BASE_URL = "https://api.tripo3d.ai/v2/openapi";

export type TripoStatus = "pending" | "running" | "success" | "error";

export type TripoJob = {
  id: string;
  status: TripoStatus;
  progress: number;
  modelUrl?: string;
  errorMessage?: string;
  consumedCredit?: number;
};

type TripoTaskResponse = {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    status?: string;
    progress?: number;
    consumed_credit?: number;
    output?: {
      model?: string;
      pbr_model?: string;
      base_model?: string;
      rendered_image?: string;
    };
  };
};

function apiKey(): string | null {
  const value = process.env.TRIPO_API_KEY?.trim();
  return value || null;
}

export function isTripoConfigured(): boolean {
  return apiKey() !== null;
}

function headers(): HeadersInit {
  const key = apiKey();
  if (!key) throw new Error("Tripo não configurado no servidor.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function normalizePrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const suffix = " Realistic game-ready GTA V FiveM environment, complete exterior, believable architecture, visible requested interior areas, doors and windows with depth, clean UVs, PBR materials, no people, no vehicles unless requested.";
  return `${cleaned}${suffix}`.slice(0, 1024);
}

function normalizeFaceLimit(): number {
  const parsed = Number.parseInt(process.env.TRIPO_FACE_LIMIT ?? "120000", 10);
  if (!Number.isFinite(parsed)) return 120000;
  return Math.max(5000, Math.min(parsed, 250000));
}

function modelVersion(): string {
  return process.env.TRIPO_MODEL_VERSION?.trim() || "v3.1-20260211";
}

function textureQuality(): "standard" | "detailed" {
  return process.env.TRIPO_TEXTURE_QUALITY?.trim().toLowerCase() === "detailed" ? "detailed" : "standard";
}

function parseResponse(payload: TripoTaskResponse): TripoTaskResponse["data"] {
  if (payload.code !== 0 || !payload.data) {
    throw new Error(payload.message?.trim() || `Tripo retornou código ${payload.code ?? "desconhecido"}.`);
  }
  return payload.data;
}

export async function createTripoTextTo3D(prompt: string): Promise<{ jobId: string }> {
  const response = await fetch(`${TRIPO_BASE_URL}/task`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      type: "text_to_model",
      model_version: modelVersion(),
      prompt: normalizePrompt(prompt),
      negative_prompt: "low quality, blurry, flat facade, floating geometry, pedestal, text labels, people, watermark",
      texture: true,
      pbr: true,
      texture_quality: textureQuality(),
      export_uv: true,
      auto_size: true,
      face_limit: normalizeFaceLimit(),
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as TripoTaskResponse;
  if (!response.ok) {
    throw new Error(payload.message?.trim() || `Tripo respondeu HTTP ${response.status}.`);
  }

  const data = parseResponse(payload);
  if (!data?.task_id) throw new Error("Tripo não retornou task_id.");
  return { jobId: data.task_id };
}

function normalizeStatus(status: string | undefined): TripoStatus {
  if (status === "success") return "success";
  if (status === "queued") return "pending";
  if (status === "running") return "running";
  if (["failed", "banned", "expired", "cancelled", "unknown"].includes(status ?? "")) return "error";
  return "pending";
}

export async function getTripoJob(jobId: string): Promise<TripoJob> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) throw new Error("task_id da Tripo inválido.");

  const response = await fetch(`${TRIPO_BASE_URL}/task/${encodeURIComponent(jobId)}`, {
    headers: headers(),
    cache: "no-store",
  });
  const payload = (await response.json()) as TripoTaskResponse;
  if (!response.ok) {
    throw new Error(payload.message?.trim() || `Tripo respondeu HTTP ${response.status}.`);
  }

  const data = parseResponse(payload);
  const status = normalizeStatus(data?.status);
  const progress = status === "success"
    ? 100
    : Math.max(0, Math.min(99, Math.round(data?.progress ?? 0)));
  const modelUrl = data?.output?.pbr_model || data?.output?.model;

  if (status === "success" && !modelUrl) {
    return {
      id: jobId,
      status: "error",
      progress: 100,
      errorMessage: "A Tripo concluiu a tarefa, mas não retornou um modelo PBR/GLB utilizável.",
      ...(typeof data?.consumed_credit === "number" ? { consumedCredit: data.consumed_credit } : {}),
    };
  }

  const base: TripoJob = {
    id: jobId,
    status,
    progress,
    ...(modelUrl ? { modelUrl } : {}),
    ...(typeof data?.consumed_credit === "number" ? { consumedCredit: data.consumed_credit } : {}),
  };

  if (status === "error") {
    return { ...base, errorMessage: `A tarefa Tripo terminou com status '${data?.status ?? "unknown"}'.` };
  }

  return base;
}
