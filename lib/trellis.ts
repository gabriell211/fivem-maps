const DEFAULT_SPACE_URL = "https://suvadityamuk-trellis-text-to-3d.hf.space";
const ENDPOINT = "generate_and_extract_glb";

export type TrellisJob = {
  id: string;
  status: "running" | "success" | "error";
  progress: number;
  modelUrl?: string;
  errorMessage?: string;
};

type GradioSubmitResponse = {
  event_id?: string;
};

function spaceUrl(): string {
  return (process.env.TRELLIS_SPACE_URL?.trim() || DEFAULT_SPACE_URL).replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  const token = process.env.HF_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders(): HeadersInit {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
  };
}

function normalizePrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const suffix = [
    "Single coherent architectural environment asset for GTA V / FiveM.",
    "Realistic proportions, complete exterior and requested visible interior areas.",
    "Detailed doors, windows, trims and structural depth.",
    "Game-ready UV mapping and realistic textured materials.",
    "No people, labels, watermark, pedestal or floating geometry.",
  ].join(" ");
  return `${cleaned} ${suffix}`.slice(0, 1800);
}

function textureSize(): number {
  const parsed = Number.parseInt(process.env.TRELLIS_TEXTURE_SIZE ?? "1024", 10);
  if (parsed >= 2048) return 2048;
  if (parsed >= 1024) return 1024;
  return 512;
}

function generationArgs(prompt: string): Record<string, string | number> {
  return {
    prompt: normalizePrompt(prompt),
    seed: Math.floor(Math.random() * 2_147_483_647),
    ss_guidance_strength: 7.5,
    ss_sampling_steps: 12,
    slat_guidance_strength: 7.5,
    slat_sampling_steps: 12,
    mesh_simplify: 0.95,
    texture_size: textureSize(),
  };
}

async function submitV2(prompt: string): Promise<Response> {
  return fetch(`${spaceUrl()}/gradio_api/call/v2/${ENDPOINT}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(generationArgs(prompt)),
    cache: "no-store",
  });
}

async function submitLegacy(prompt: string): Promise<Response> {
  const args = generationArgs(prompt);
  return fetch(`${spaceUrl()}/gradio_api/call/${ENDPOINT}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      data: [
        args.prompt,
        args.seed,
        args.ss_guidance_strength,
        args.ss_sampling_steps,
        args.slat_guidance_strength,
        args.slat_sampling_steps,
        args.mesh_simplify,
        args.texture_size,
      ],
    }),
    cache: "no-store",
  });
}

function friendlySpaceError(message: string): string {
  if (/quota|gpu quota|zero.?gpu|exceeded|429/i.test(message)) {
    return "O limite gratuito de GPU do TRELLIS foi atingido. Uma conta Hugging Face com HF_TOKEN aumenta a cota diária gratuita; tente novamente após a renovação da cota.";
  }
  if (/queue|busy|capacity|503/i.test(message)) {
    return "O TRELLIS gratuito está com a fila de GPU cheia. Tente novamente em alguns minutos.";
  }
  return message || "O TRELLIS ZeroGPU não conseguiu iniciar a geração.";
}

export async function createTrellisTextTo3D(prompt: string): Promise<{ jobId: string }> {
  let response = await submitV2(prompt);
  if (response.status === 404 || response.status === 405 || response.status === 422) {
    response = await submitLegacy(prompt);
  }

  const text = await response.text();
  let payload: GradioSubmitResponse = {};
  try {
    payload = JSON.parse(text) as GradioSubmitResponse;
  } catch {
    if (!response.ok) throw new Error(friendlySpaceError(text));
  }

  if (!response.ok || !payload.event_id) {
    throw new Error(friendlySpaceError(text));
  }
  return { jobId: payload.event_id };
}

function parseSseBlocks(text: string): Array<{ event: string; data: string }> {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      return { event, data: data.join("\n") };
    })
    .filter((item) => item.data.length > 0);
}

function findGlbUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (/^https:\/\//i.test(value) && (value.toLowerCase().includes(".glb") || value.includes("gradio_api/file"))) return value;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findGlbUrl(value[index]);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["url", "path", "value", "data"]) {
      const found = findGlbUrl(record[key]);
      if (found) return found;
    }
    for (const nested of Object.values(record)) {
      const found = findGlbUrl(nested);
      if (found) return found;
    }
  }
  return undefined;
}

export function isAllowedTrellisModelUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return url.hostname === new URL(spaceUrl()).hostname || url.hostname.endsWith(".hf.space");
  } catch {
    return false;
  }
}

export async function waitForTrellisJob(jobId: string): Promise<TrellisJob> {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(jobId)) throw new Error("event_id do TRELLIS inválido.");

  const response = await fetch(`${spaceUrl()}/gradio_api/call/${ENDPOINT}/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(285_000),
  });
  const text = await response.text();
  if (!response.ok) {
    return { id: jobId, status: "error", progress: 0, errorMessage: friendlySpaceError(text) };
  }

  const blocks = parseSseBlocks(text);
  const failure = [...blocks].reverse().find((block) => block.event === "error");
  if (failure) {
    return { id: jobId, status: "error", progress: 100, errorMessage: friendlySpaceError(failure.data) };
  }

  const complete = [...blocks].reverse().find((block) => block.event === "complete");
  if (!complete) {
    return { id: jobId, status: "running", progress: 80 };
  }

  let result: unknown;
  try {
    result = JSON.parse(complete.data) as unknown;
  } catch {
    return { id: jobId, status: "error", progress: 100, errorMessage: "O TRELLIS terminou, mas retornou uma resposta inválida." };
  }

  const modelUrl = findGlbUrl(result);
  if (!modelUrl || !isAllowedTrellisModelUrl(modelUrl)) {
    return { id: jobId, status: "error", progress: 100, errorMessage: "O TRELLIS terminou sem retornar um GLB texturizado utilizável." };
  }

  return { id: jobId, status: "success", progress: 100, modelUrl };
}

export function isTrellisAvailable(): boolean {
  return process.env.TRELLIS_DISABLED?.trim() !== "1";
}
