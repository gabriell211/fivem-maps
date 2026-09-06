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

const AXES = ["X", "Y", "Z"] as const;
type ModelStatus = "idle" | "pending" | "running" | "success" | "error";
type StudioStatus = "idle" | "planning" | "generating" | "ready" | "error";
type ModelPayload = {
  id?: string;
  status?: Exclude<ModelStatus, "idle">;
  error?: string;
  modelUrl?: string;
  previewUrl?: string;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function generationCopy(progress: number): string {
  if (progress < 12) return "Interpretando sua descrição";
  if (progress < 24) return "Planejando arquitetura e proporções";
  if (progress < 42) return "Gerando a geometria 3D detalhada";
  if (progress < 62) return "Construindo detalhes, fachada e interiores";
  if (progress < 78) return "Aplicando UVs, materiais e texturas";
  if (progress < 92) return "Otimizando o modelo para FiveM";
  if (progress < 100) return "Finalizando e validando o modelo";
  return "Mapa 3D pronto";
}

function GenerationProgress({ progress }: { progress: number }) {
  const normalized = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="generation-progress" role="status" aria-live="polite" aria-label={`Geração do mapa em ${normalized}%`}>
      <div className="generation-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
        <div className="generation-percent">{normalized}%</div>
      </div>
      <div className="generation-copy">
        <span className="eyebrow">GERANDO MAPA</span>
        <strong>{generationCopy(normalized)}</strong>
        <p>O preview só será exibido quando o modelo final texturizado estiver concluído.</p>
      </div>
      <div className="generation-bar" aria-hidden="true">
        <div className="generation-bar-fill" style={{ width: `${normalized}%` }} />
      </div>
      <div className="generation-stage-row" aria-hidden="true">
        <span className={normalized >= 10 ? "done" : "active"}>Prompt</span>
        <span className={normalized >= 25 ? "done" : normalized >= 10 ? "active" : ""}>Estrutura</span>
        <span className={normalized >= 55 ? "done" : normalized >= 25 ? "active" : ""}>3D</span>
        <span className={normalized >= 80 ? "done" : normalized >= 55 ? "active" : ""}>Texturas</span>
        <span className={normalized === 100 ? "done" : normalized >= 80 ? "active" : ""}>Finalização</span>
      </div>
    </div>
  );
}

export function MapStudio() {
  const [prompt, setPrompt] = useState(EXAMPLES[0] ?? "");
  const [scene, setScene] = useState<SceneSpec | null>(null);
  const [status, setStatus] = useState<StudioStatus>("idle");
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [modelPreviewUrl, setModelPreviewUrl] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!scene || status !== "ready") return null;
    return [
      ["Objetos", scene.metadata.estimatedEntities.toString()],
      ["Draw calls", `~${scene.metadata.estimatedDrawCalls}`],
      ["Interior", scene.metadata.hasInterior ? "Sim" : "Não"],
      ["Estilo", scene.style],
    ];
  }, [scene, status]);

  async function pollGeneratedModel(initialScene: SceneSpec): Promise<void> {
    const sourceModel = initialScene.sourceModel;
    if (!sourceModel || sourceModel.provider !== "sloyd") {
      throw new Error("O motor de geração 3D não foi iniciado.");
    }

    if (sourceModel.status === "error") {
      throw new Error(sourceModel.error ?? "O motor de geração 3D está indisponível.");
    }

    setModelStatus(sourceModel.status);
    setStatus("generating");
    setGenerationProgress((current) => Math.max(current, 20));

    for (let attempt = 0; attempt < 300; attempt += 1) {
      await sleep(2000);
      const response = await fetch(`/api/model/${encodeURIComponent(sourceModel.jobId)}`, { cache: "no-store" });
      const payload = (await response.json()) as ModelPayload;

      if (!response.ok) throw new Error(payload.error ?? "Falha ao acompanhar a geração 3D.");
      const nextStatus = payload.status ?? "running";
      setModelStatus(nextStatus);

      if (nextStatus === "pending" || nextStatus === "running") {
        setGenerationProgress((current) => {
          const timeProgress = 20 + Math.min(72, Math.round((attempt + 1) * 1.15));
          return Math.max(current, timeProgress);
        });
      }

      if (nextStatus === "success" && payload.modelUrl && payload.previewUrl) {
        setGenerationProgress(96);
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

        // Give the GLB viewer a short window to receive the final URL before revealing it.
        await sleep(450);
        setGenerationProgress(100);
        setModelStatus("success");
        setStatus("ready");
        return;
      }

      if (nextStatus === "error") {
        const message = payload.error ?? "O gerador 3D não conseguiu concluir o modelo.";
        setModelStatus("error");
        setStatus("error");
        setScene((current) => current ? {
          ...current,
          sourceModel: {
            provider: "sloyd",
            jobId: sourceModel.jobId,
            status: "error",
            error: message,
          },
        } : current);
        throw new Error(message);
      }
    }

    setModelStatus("error");
    setStatus("error");
    throw new Error("A geração 3D excedeu o tempo máximo de acompanhamento.");
  }

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setScene(null);
    setModelPreviewUrl(null);
    setModelStatus("idle");
    setGenerationProgress(4);
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
          : "Não foi possível iniciar a geração do mapa.";
        throw new Error(message);
      }

      const generatedScene = payload.scene as SceneSpec;
      if (generatedScene.sourceModel?.status === "error") {
        throw new Error(generatedScene.sourceModel.error ?? "O motor de geração 3D não está configurado.");
      }

      setScene(generatedScene);
      setGenerationProgress(18);
      await pollGeneratedModel(generatedScene);
    } catch (cause) {
      setStatus("error");
      setModelStatus("error");
      setGenerationProgress(0);
      setError(cause instanceof Error ? cause.message : "Falha inesperada.");
    }
  }

  function updateWorldPosition(axis: 0 | 1 | 2, rawValue: string): void {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const value = Math.max(-10000, Math.min(10000, parsed));
    setScene((current) => {
      if (!current) return current;
      const worldPosition: [number, number, number] = [
        current.worldPosition[0],
        current.worldPosition[1],
        current.worldPosition[2],
      ];
      worldPosition[axis] = value;
      return { ...current, worldPosition };
    });
  }

  function downloadScene() {
    if (!scene || status !== "ready") return;
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scene.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "fivem-map"}.scene.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const isGenerating = status === "planning" || status === "generating";
  const isReady = status === "ready" && modelStatus === "success" && Boolean(modelPreviewUrl);
  const providerLabel = isReady
    ? "Mapa 3D pronto"
    : isGenerating
      ? `Gerando mapa • ${Math.round(generationProgress)}%`
      : status === "error"
        ? "Geração interrompida"
        : "Pronto para gerar";

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div><strong>FiveM Map Forge</strong><span>Text → 3D → Blender → Sollumz → FiveM</span></div>
        </div>
        <div className="topbar-actions">
          <span className={`status-pill ${isReady ? "ready" : isGenerating ? "working" : status === "error" ? "failed" : ""}`}><i /> {providerLabel}</span>
          {isReady && (
            <>
              <button className="ghost-button" type="button" onClick={downloadScene}>Baixar SceneSpec</button>
              <ExportButton scene={scene} />
            </>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <span className="eyebrow">TEXT → FIVEM</span>
            <h1>Descreva. Gere. Veja. Exporte.</h1>
            <p>O sistema gera o modelo completo e só revela o preview quando geometria e texturas estiverem prontas.</p>
          </div>

          <form onSubmit={generate} className="prompt-form">
            <label htmlFor="map-prompt">O que você quer criar?</label>
            <textarea
              id="map-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              maxLength={1800}
              disabled={isGenerating}
              placeholder="Ex.: hospital abandonado com estacionamento, corredores internos, recepção destruída e luz vermelha..."
            />
            <div className="prompt-meta"><span>{prompt.length}/1800</span><span>Português natural</span></div>
            <button className="primary-button" type="submit" disabled={isGenerating}>
              {isGenerating ? `Gerando mapa... ${Math.round(generationProgress)}%` : "Gerar mapa"}
            </button>
            {error && <p className="error-message" role="alert">{error}</p>}
          </form>

          {isReady && scene && (
            <div className="placement-card">
              <div className="placement-heading">
                <span className="section-label">POSIÇÃO NO GTA</span>
                <small>Origem mundial do mapa</small>
              </div>
              <div className="coordinate-grid">
                {AXES.map((axis, index) => (
                  <label key={axis}>
                    <span>{axis}</span>
                    <input
                      type="number"
                      min={-10000}
                      max={10000}
                      step="0.1"
                      value={scene.worldPosition[index]}
                      onChange={(event) => updateWorldPosition(index as 0 | 1 | 2, event.target.value)}
                      aria-label={`Coordenada ${axis} do mapa no GTA`}
                    />
                  </label>
                ))}
              </div>
              <p>Use as coordenadas do local onde o mapa deve aparecer. A geometria continua local; o YMAP recebe esta transformação.</p>
            </div>
          )}

          {!isGenerating && (
            <div className="example-list">
              <span className="section-label">EXEMPLOS RÁPIDOS</span>
              {EXAMPLES.map((example) => (
                <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>
              ))}
            </div>
          )}
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar">
            <div>
              <span className="section-label">{isGenerating ? "PROCESSAMENTO" : "PREVIEW 3D"}</span>
              <strong>{isReady ? scene?.name : isGenerating ? generationCopy(generationProgress) : "Nova cena"}</strong>
            </div>
            {isGenerating && <strong className="toolbar-progress-value">{Math.round(generationProgress)}%</strong>}
          </div>

          {isGenerating ? (
            <div className="preview-shell processing-shell">
              <GenerationProgress progress={generationProgress} />
            </div>
          ) : isReady ? (
            <ScenePreview scene={scene} modelUrl={modelPreviewUrl} />
          ) : (
            <div className="preview-shell preview-placeholder">
              <div className="preview-empty">
                <span className="eyebrow">PREVIEW 3D FINAL</span>
                <strong>Seu mapa completo aparecerá aqui</strong>
                <p>Durante a geração você verá apenas o progresso. Nenhum blockout ou geometria provisória será exibido.</p>
              </div>
            </div>
          )}

          {isReady && (
            <div className="bottom-grid">
              <div className="stat-card wide">
                <span className="section-label">PIPELINE CONCLUÍDO</span>
                <div className="pipeline-list">
                  <span className="done">Planejamento</span>
                  <span className="done">Modelo 3D</span>
                  <span className="done">UV + texturas</span>
                  <span className="done">Preview final</span>
                  <span>Blender + Sollumz no export</span>
                </div>
              </div>
              <div className="stats-card">
                <span className="section-label">CENA</span>
                {stats ? stats.map(([label, value]) => (
                  <div className="stat-row" key={label}><span>{label}</span><strong>{value}</strong></div>
                )) : null}
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
