"use client";

import { FormEvent, useMemo, useState } from "react";
import type { SceneSpec } from "@/lib/scene-schema";
import { ExportButton } from "./export-button";
import { ScenePreview } from "./scene-preview";

const EXAMPLES = [
  "Hospital moderno com estacionamento, recepção, corredores internos e iluminação externa",
  "Delegacia industrial com garagem, pátio cercado e estacionamento para viaturas",
  "Mansão de luxo com jardim, lago pequeno e entrada de vidro",
  "Galpão abandonado com pátio, iluminação vermelha e área interna degradada",
];

type ModelStatus = "idle" | "pending" | "running" | "success" | "error";
type ModelPayload = {
  id?: string;
  status?: Exclude<ModelStatus, "idle">;
  error?: string;
  modelUrl?: string;
  previewUrl?: string;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function MapStudio() {
  const [prompt, setPrompt] = useState(EXAMPLES[0] ?? "");
  const [scene, setScene] = useState<SceneSpec | null>(null);
  const [status, setStatus] = useState<"idle" | "planning" | "preview" | "error">("idle");
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [modelPreviewUrl, setModelPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!scene) return null;
    return [
      ["Objetos", scene.metadata.estimatedEntities.toString()],
      ["Draw calls", `~${scene.metadata.estimatedDrawCalls}`],
      ["Interior", scene.metadata.hasInterior ? "Sim" : "Não"],
      ["Estilo", scene.style],
    ];
  }, [scene]);

  async function pollGeneratedModel(initialScene: SceneSpec): Promise<void> {
    const sourceModel = initialScene.sourceModel;
    if (!sourceModel || sourceModel.provider !== "sloyd") {
      setModelStatus("idle");
      return;
    }

    if (sourceModel.status === "error") {
      setModelStatus("error");
      return;
    }

    setModelStatus(sourceModel.status);
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await sleep(2000);
      const response = await fetch(`/api/model/${encodeURIComponent(sourceModel.jobId)}`, { cache: "no-store" });
      const payload = (await response.json()) as ModelPayload;

      if (!response.ok) throw new Error(payload.error ?? "Falha ao acompanhar a geração 3D.");
      const nextStatus = payload.status ?? "running";
      setModelStatus(nextStatus);

      if (nextStatus === "success" && payload.modelUrl && payload.previewUrl) {
        setModelPreviewUrl(payload.previewUrl);
        setScene((current) => current ? {
          ...current,
          sourceModel: {
            provider: "sloyd",
            jobId: sourceModel.jobId,
            status: "success",
            url: payload.modelUrl,
          },
        } : current);
        return;
      }

      if (nextStatus === "error") {
        setScene((current) => current ? {
          ...current,
          sourceModel: {
            provider: "sloyd",
            jobId: sourceModel.jobId,
            status: "error",
            error: payload.error ?? "O Sloyd não conseguiu gerar o modelo.",
          },
        } : current);
        return;
      }
    }

    setModelStatus("error");
    throw new Error("A geração 3D excedeu o tempo máximo de acompanhamento.");
  }

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setModelPreviewUrl(null);
    setModelStatus("idle");
    setStatus("planning");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || !("scene" in payload)) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Não foi possível gerar a cena.";
        throw new Error(message);
      }

      const generatedScene = payload.scene as SceneSpec;
      setScene(generatedScene);
      setStatus("preview");
      await pollGeneratedModel(generatedScene);
    } catch (cause) {
      setStatus((current) => current === "preview" ? "preview" : "error");
      setError(cause instanceof Error ? cause.message : "Falha inesperada.");
    }
  }

  function downloadScene() {
    if (!scene) return;
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scene.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "fivem-map"}.scene.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const providerLabel = modelStatus === "success"
    ? "Modelo IA pronto"
    : modelStatus === "pending" || modelStatus === "running"
      ? "Gerando modelo IA..."
      : modelStatus === "error"
        ? "IA indisponível • fallback procedural"
        : "Preview procedural";

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div><strong>FiveM Map Forge</strong><span>Text → 3D → Blender → Sollumz → FiveM</span></div>
        </div>
        <div className="topbar-actions">
          <span className="status-pill"><i /> {providerLabel}</span>
          <button className="ghost-button" type="button" onClick={downloadScene} disabled={!scene}>Baixar SceneSpec</button>
          <ExportButton scene={scene} />
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <span className="eyebrow">TEXT → FIVEM</span>
            <h1>Descreva. Gere. Veja. Exporte.</h1>
            <p>O sistema transforma sua descrição em uma cena 3D e prepara a exportação pelo Blender + Sollumz.</p>
          </div>

          <form onSubmit={generate} className="prompt-form">
            <label htmlFor="map-prompt">O que você quer criar?</label>
            <textarea
              id="map-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              maxLength={1800}
              placeholder="Ex.: hospital abandonado com estacionamento, corredores internos, recepção destruída e luz vermelha..."
            />
            <div className="prompt-meta"><span>{prompt.length}/1800</span><span>Português natural</span></div>
            <button className="primary-button" type="submit" disabled={status === "planning" || modelStatus === "pending" || modelStatus === "running"}>
              {status === "planning" ? "Planejando mapa..." : modelStatus === "pending" || modelStatus === "running" ? "Gerando 3D..." : "Gerar mapa"}
            </button>
            {error && <p className="error-message" role="alert">{error}</p>}
          </form>

          <div className="example-list">
            <span className="section-label">EXEMPLOS RÁPIDOS</span>
            {EXAMPLES.map((example) => (
              <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>
            ))}
          </div>
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar">
            <div>
              <span className="section-label">LIVE PREVIEW</span>
              <strong>{scene?.name ?? "Nova cena"}</strong>
            </div>
            <div className="pipeline-steps">
              <span className={status !== "idle" ? "active" : ""}>01 Prompt</span>
              <span className={status === "planning" || status === "preview" ? "active" : ""}>02 Planejamento</span>
              <span className={status === "preview" ? "active" : ""}>03 Preview</span>
              <span className={modelStatus === "success" ? "active" : ""}>04 Modelo IA</span>
              <span>05 Sollumz</span>
            </div>
          </div>

          <ScenePreview scene={scene} modelUrl={modelPreviewUrl} />

          <div className="bottom-grid">
            <div className="stat-card wide">
              <span className="section-label">PIPELINE</span>
              <div className="pipeline-list">
                <span className="done">Scene planner</span>
                <span className={scene ? "done" : ""}>3D preview</span>
                <span className={modelStatus === "success" ? "done" : ""}>Sloyd text-to-3D</span>
                <span>Blender + Sollumz export</span>
                <span>FiveM resource ZIP</span>
              </div>
            </div>
            <div className="stats-card">
              <span className="section-label">CENA</span>
              {stats ? stats.map(([label, value]) => (
                <div className="stat-row" key={label}><span>{label}</span><strong>{value}</strong></div>
              )) : <p className="muted">Gere uma cena para ver as métricas.</p>}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
