const TRIPO_BASE_URL = "https://openapi.tripo3d.ai/v3";

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
  suggestion?: string;
  data?: {
    task_id?: string;
    type?: string;
    status?: string;
    progress?: number;
    credits_consumed?: number;
    output?: {
      model_url?: string;
      rendered_image_url?: string;
    };
  };
};

type TripoBalanceResponse = {
  code?: number;
  message?: string;
  suggestion?: string;
  data?: {
    balance?: number;
    frozen?: number;
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

function requiredCredits(): number {
  // Tripo H3.1 Text-to-3D: 20 credits with standard texture, 30 with detailed texture.
  return textureQuality() === "detailed" ? 30 : 20;
}

function tripoError(payload: { code?: number; message?: string; suggestion?: string }, httpStatus?: number): Error {
  const message = payload.message?.trim() ?? "";
  const insufficient = payload.code === 2010 || /insufficient|not enough credit/i.test(message);
  if (insufficient) {
    return new Error(
      "Saldo da API Tripo insuficiente. Os créditos gratuitos do Tripo Studio são separados dos créditos da API. Adicione créditos de API ou use outro provider.",
    );
  }

  const suggestion = payload.suggestion?.trim();
  const detail = [message, suggestion].filter(Boolean).join(" — ");
  return new Error(detail || `Tripo respondeu HTTP ${httpStatus ?? "desconhecido"}.`);
}

function parseTaskResponse(payload: TripoTaskResponse): NonNullable<TripoTaskResponse["data"]> {
  if (payload.code !== 0 || !payload.data) throw tripoError(payload);
  return payload.data;
}

export async function getTripoBalance(): Promise<{ balance: number; frozen: number }> {
  const response = await fetch(`${TRIPO_BASE_URL}/account/balance`, {
    headers: headers(),
    cache: "no-store",
  });
  const payload = (await response.json()) as TripoBalanceResponse;
  if (!response.ok || payload.code !== 0 || !payload.data) throw tripoError(payload, response.status);

  return {
    balance: Number(payload.data.balance ?? 0),
    frozen: Number(payload.data.frozen ?? 0),
  };
}

export async function createTripoTextTo3D(prompt: string): Promise<{ jobId: string }> {
  const { balance } = await getTripoBalance();
  const minimum = requiredCredits();
  if (balance < minimum) {
    throw new Error(
      `Saldo da API Tripo insuficiente: ${balance} crédito(s) disponível(is), ${minimum} necessários para gerar este modelo texturizado. Créditos do Tripo Studio não podem ser usados pela API.`,
    );
  }

  const response = await fetch(`${TRIPO_BASE_URL}/generation/text-to-model`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt: normalizePrompt(prompt),
      model: modelVersion(),
      negative_prompt: "low quality, blurry, flat facade, floating geometry, pedestal, text labels, people, watermark",
      texture: true,
      pbr: true,
      texture_quality: textureQuality(),
      geometry_quality: "standard",
      export_uv: true,
      auto_size: true,
      face_limit: normalizeFaceLimit(),
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as TripoTaskResponse;
  if (!response.ok) throw tripoError(payload, response.status);

  const data = parseTaskResponse(payload);
  if (!data.task_id) throw new Error("Tripo não retornou task_id.");
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

  const response = await fetch(`${TRIPO_BASE_URL}/tasks/${encodeURIComponent(jobId)}`, {
    headers: headers(),
    cache: "no-store",
  });
  const payload = (await response.json()) as TripoTaskResponse;
  if (!response.ok) throw tripoError(payload, response.status);

  const data = parseTaskResponse(payload);
  const status = normalizeStatus(data.status);
  const progress = status === "success"
    ? 100
    : Math.max(0, Math.min(99, Math.round(data.progress ?? 0)));
  const modelUrl = data.output?.model_url;

  if (status === "success" && !modelUrl) {
    return {
      id: jobId,
      status: "error",
      progress: 100,
      errorMessage: "A Tripo concluiu a tarefa, mas não retornou um GLB/PBR utilizável.",
      ...(typeof data.credits_consumed === "number" ? { consumedCredit: data.credits_consumed } : {}),
    };
  }

  const base: TripoJob = {
    id: jobId,
    status,
    progress,
    ...(modelUrl ? { modelUrl } : {}),
    ...(typeof data.credits_consumed === "number" ? { consumedCredit: data.credits_consumed } : {}),
  };

  if (status === "error") {
    return { ...base, errorMessage: `A tarefa Tripo terminou com status '${data.status ?? "unknown"}'.` };
  }

  return base;
}
