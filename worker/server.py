from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(os.getenv("MAP_FORGE_JOBS", "./jobs")).resolve()
BLENDER = os.getenv("BLENDER_BIN", "blender")
EXPORT_SCRIPT = Path(__file__).with_name("export_scene.py").resolve()
ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="FiveM Map Forge Worker", version="0.1.0")


class ExportRequest(BaseModel):
    scene: dict[str, Any] = Field(...)


def job_dir(job_id: str) -> Path:
    return ROOT / job_id


def status_path(job_id: str) -> Path:
    return job_dir(job_id) / "status.json"


def write_status(job_id: str, status: str, progress: int, error: str | None = None) -> None:
    payload: dict[str, Any] = {"id": job_id, "status": status, "progress": progress}
    if error:
        payload["error"] = error[-4000:]
    status_path(job_id).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def run_export(job_id: str) -> None:
    directory = job_dir(job_id)
    scene_path = directory / "scene.json"
    output = directory / "output"
    output.mkdir(parents=True, exist_ok=True)
    write_status(job_id, "exporting", 55)

    try:
        process = subprocess.run(
            [BLENDER, "--background", "--python", str(EXPORT_SCRIPT), "--", str(scene_path), str(output)],
            capture_output=True,
            text=True,
            timeout=60 * 20,
            check=False,
        )
        (directory / "blender.log").write_text(
            f"STDOUT\n{process.stdout}\n\nSTDERR\n{process.stderr}", encoding="utf-8"
        )
        if process.returncode != 0:
            raise RuntimeError(process.stderr or process.stdout or f"Blender saiu com código {process.returncode}")

        resource = output / "fivem_resource"
        if not resource.exists():
            raise RuntimeError("O worker terminou, mas o resource FiveM não foi produzido.")

        archive_base = directory / "fivem-map"
        zip_path = Path(shutil.make_archive(str(archive_base), "zip", root_dir=resource))
        if not zip_path.exists():
            raise RuntimeError("Falha ao criar o ZIP final.")
        write_status(job_id, "ready", 100)
    except Exception as exc:  # worker boundary: preserve error for the web client
        write_status(job_id, "failed", 100, str(exc))


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "blender": BLENDER,
        "exportScript": str(EXPORT_SCRIPT),
    }


@app.post("/v1/exports", status_code=202)
def create_export(request: ExportRequest) -> dict[str, Any]:
    scene = request.scene
    if not isinstance(scene.get("objects"), list) or not scene.get("name"):
        raise HTTPException(status_code=400, detail="SceneSpec inválida.")

    job_id = str(uuid.uuid4())
    directory = job_dir(job_id)
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=2), encoding="utf-8")
    write_status(job_id, "queued", 10)
    threading.Thread(target=run_export, args=(job_id,), daemon=True).start()
    return {"id": job_id, "status": "queued", "progress": 10}


@app.get("/v1/exports/{job_id}")
def get_export(job_id: str) -> dict[str, Any]:
    path = status_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Job não encontrado.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("status") == "ready":
        payload["downloadUrl"] = f"/v1/exports/{job_id}/download"
    return payload


@app.get("/v1/exports/{job_id}/download")
def download_export(job_id: str) -> FileResponse:
    archive = job_dir(job_id) / "fivem-map.zip"
    if not archive.exists():
        raise HTTPException(status_code=404, detail="Arquivo ainda não está pronto.")
    return FileResponse(archive, media_type="application/zip", filename=f"fivem-map-{job_id[:8]}.zip")
