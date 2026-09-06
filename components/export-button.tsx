"use client";

import { useState } from "react";
import type { SceneSpec } from "@/lib/scene-schema";

type ExportState = "idle" | "queued" | "exporting" | "ready" | "failed";

type ExportPayload = {
  id?: string;
  status?: ExportState;
  progress?: number;
  downloadUrl?: string;
  error?: string;
  detail?: string;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function ExportButton({ scene }: { scene: SceneSpec | null }) {
  const [state, setState] = useState<ExportState>("idle");
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modelReady = scene?.sourceModel?.status === "success";
  const modelStillGenerating = scene?.sourceModel?.status === "pending" || scene?.sourceModel?.status === "running";
  const modelUnavailable = Boolean(scene) && !modelReady && !modelStillGenerating;
  const busy = state === "queued" || state === "exporting";

  async function startExport() {
    if (!scene || !modelReady) return;
    setState("queued");
    setProgress(5);
    setDownloadUrl(null);
    setError(null);

    try {
      const createResponse = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene }),
      });
      const created = (await createResponse.json()) as ExportPayload;
      if (!createResponse.ok || !created.id) {
        throw new Error(created.error ?? created.detail ?? "Não foi possível iniciar a exportação.");
      }

      for (let attempt = 0; attempt < 600; attempt += 1) {
        await sleep(2000);
        const statusResponse = await fetch(`/api/export/${encodeURIComponent(created.id)}`, { cache: "no-store" });
        const payload = (await statusResponse.json()) as ExportPayload;
        if (!statusResponse.ok) {
          throw new Error(payload.error ?? payload.detail ?? "Falha ao consultar o worker.");
        }

        setState(payload.status ?? "exporting");
        setProgress(payload.progress ?? 0);

        if (payload.status === "ready" && payload.downloadUrl) {
          setDownloadUrl(payload.downloadUrl);
          return;
        }
        if (payload.status === "failed") {
          throw new Error(payload.error ?? "O Blender/Sollumz não conseguiu exportar o mapa.");
        }
      }

      throw new Error("A exportação excedeu o tempo máximo de acompanhamento no navegador.");
    } catch (cause) {
      setState("failed");
      setError(cause instanceof Error ? cause.message : "Erro inesperado na exportação.");
    }
  }

  if (downloadUrl) {
    return <a className="primary-button export-link" href={downloadUrl}>Baixar ZIP FiveM</a>;
  }

  const label = modelStillGenerating
    ? "Gerando modelo 3D..."
    : modelUnavailable
      ? "Modelo 3D necessário"
      : busy
        ? `Exportando ${progress}%`
        : "Gerar ZIP FiveM";

  return (
    <div className="export-control">
      <button
        className="primary-button"
        type="button"
        onClick={startExport}
        disabled={!scene || busy || !modelReady}
        title={modelUnavailable ? "A exportação só é liberada depois que o modelo 3D real estiver pronto." : undefined}
      >
        {label}
      </button>
      {error && <span className="export-error" title={error}>Falhou: {error}</span>}
    </div>
  );
}
