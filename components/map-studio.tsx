"use client";

import { FormEvent, useMemo, useState } from "react";
import type { SceneSpec } from "@/lib/scene-schema";
import { ScenePreview } from "./scene-preview";

const EXAMPLES = [
  "Hospital moderno com estacionamento, recepção, corredores internos e iluminação externa",
  "Delegacia industrial com garagem, pátio cercado e estacionamento para viaturas",
  "Mansão de luxo com jardim, lago pequeno e entrada de vidro",
  "Galpão abandonado com pátio, iluminação vermelha e área interna degradada",
];

export function MapStudio() {
  const [prompt, setPrompt] = useState(EXAMPLES[0] ?? "");
  const [scene, setScene] = useState<SceneSpec | null>(null);
  const [status, setStatus] = useState<"idle" | "planning" | "preview" | "error">("idle");
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

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
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

      setScene(payload.scene as SceneSpec);
      setStatus("preview");
    } catch (cause) {
      setStatus("error");
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

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div><strong>FiveM Map Forge</strong><span>AI + Sollumz pipeline</span></div>
        </div>
        <div className="topbar-actions">
          <span className="status-pill"><i /> Blender Worker offline/local</span>
          <button className="ghost-button" type="button" onClick={downloadScene} disabled={!scene}>Exportar SceneSpec</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-heading">
            <span className="eyebrow">TEXT → FIVEM</span>
            <h1>Descreva. Gere. Veja. Exporte.</h1>
            <p>A IA monta a estrutura do mapa e prepara a cena para Blender + Sollumz.</p>
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
            <button className="primary-button" type="submit" disabled={status === "planning"}>
              {status === "planning" ? "Planejando mapa..." : "Gerar mapa"}
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
              <span>04 Sollumz</span>
            </div>
          </div>

          <ScenePreview scene={scene} />

          <div className="bottom-grid">
            <div className="stat-card wide">
              <span className="section-label">PIPELINE</span>
              <div className="pipeline-list">
                <span className="done">Scene planner</span>
                <span className={scene ? "done" : ""}>3D preview</span>
                <span>Sloyd/asset provider</span>
                <span>Blender + Sollumz export</span>
                <span>FiveM resource package</span>
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
