from __future__ import annotations

import hmac
import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

ROOT = Path(os.getenv("MAP_FORGE_JOBS", "./jobs")).resolve()
BLENDER = os.getenv("BLENDER_BIN", "blender")
EXPORT_SCRIPT = Path(__file__).with_name("export_scene.py").resolve()
WORKER_TOKEN = os.getenv("MAP_FORGE_WORKER_TOKEN", "").strip()
MAX_CONCURRENT = max(1, min(int(os.getenv("MAP_FORGE_MAX_CONCURRENT", "1")), 4))
EXPORT_TIMEOUT_SECONDS = max(60, min(int(os.getenv("MAP_FORGE_EXPORT_TIMEOUT", "1200")), 3600))
BLENDER_SEMAPHORE = threading.BoundedSemaphore(MAX_CONCURRENT)
ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="FiveM Map Forge Worker", version="0.2.0")


class SourceModel(BaseModel):
    provider: Literal["sloyd"]
    jobId: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    status: Literal["pending", "running", "success", "error"]
    url: str | None = None
    error: str | None = None


class SceneSpec(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=4096)
    style: str = Field(min_length=1, max_length=40)
    spawn: list[float] = Field(min_length=3, max_length=3)
    objects: list[dict[str, Any]] = Field(min_length=1, max_length=5000)
    sourceModel: SourceModel | None = None
    metadata: dict[str, Any]

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nome da cena vazio.")
        return value


class ExportRequest(BaseModel):
    scene: SceneSpec


def require_token(x_worker_token: str | None = Header(default=None)) -> None:
    if WORKER_TOKEN and (not x_worker_token or not hmac.compare_digest(x_worker_token, WORKER_TOKEN)):
        raise HTTPException(status_code=401, detail="Worker token inválido.")


def normalize_job_id(job_id: str) -> str:
    try:
        parsed = uuid.UUID(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Job ID inválido.") from exc
    return str(parsed)


def job_dir(job_id: str) -> Path:
    return ROOT / normalize_job_id(job_id)


def status_path(job_id: str) -> Path:
    return job_dir(job_id) / "status.json"


def write_status(job_id: str, status: str, progress: int, error: str | None = None) -> None:
    payload: dict[str, Any] = {"id": job_id, "status": status, "progress": max(0, min(progress, 100))}
    if error:
        payload["error"] = error[-6000:]
    target = status_path(job_id)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(target)


def run_export(job_id: str) -> None:
    directory = job_dir(job_id)
    scene_path = directory / "scene.json"
    output = directory / "output"
    output.mkdir(parents=True, exist_ok=True)

    try:
        with BLENDER_SEMAPHORE:
            write_status(job_id, "exporting", 50)
            process = subprocess.run(
                [BLENDER, "--background", "--python", str(EXPORT_SCRIPT), "--", str(scene_path), str(output)],
                capture_output=True,
                text=True,
                timeout=EXPORT_TIMEOUT_SECONDS,
                check=False,
                env=os.environ.copy(),
            )
            (directory / "blender.log").write_text(
                f"STDOUT\n{process.stdout}\n\nSTDERR\n{process.stderr}", encoding="utf-8"
            )
            if process.returncode != 0:
                detail = process.stderr.strip() or process.stdout.strip() or f"Blender saiu com código {process.returncode}"
                raise RuntimeError(detail[-6000:])

            resource = output / "fivem_resource"
            stream = resource / "stream"
            required_extensions = {".ydr", ".ytyp", ".ymap"}
            produced = {p.suffix.lower() for p in stream.glob("*") if p.is_file()} if stream.exists() else set()
            missing = sorted(required_extensions - produced)
            if missing:
                raise RuntimeError(f"Resource incompleto após Blender: faltando {', '.join(missing)}")
            if not (resource / "fxmanifest.lua").is_file():
                raise RuntimeError("fxmanifest.lua não foi produzido.")

            archive_base = directory / "fivem-map"
            zip_path = Path(shutil.make_archive(str(archive_base), "zip", root_dir=resource))
            if not zip_path.exists() or zip_path.stat().st_size < 1024:
                raise RuntimeError("Falha ao criar o ZIP final.")
            write_status(job_id, "ready", 100)
    except subprocess.TimeoutExpired:
        write_status(job_id, "failed", 100, f"Blender excedeu o limite de {EXPORT_TIMEOUT_SECONDS}s.")
    except Exception as exc:  # worker boundary: preserve error for the web client
        write_status(job_id, "failed", 100, str(exc))


def blender_readiness() -> tuple[bool, str]:
    executable = shutil.which(BLENDER) if not Path(BLENDER).is_absolute() else BLENDER
    if not executable or not Path(executable).exists():
        return False, f"Blender não encontrado: {BLENDER}"
    if not EXPORT_SCRIPT.is_file():
        return False, "export_scene.py ausente"

    try:
        process = subprocess.run(
            [
                BLENDER,
                "--background",
                "--python-expr",
                "import bpy; print('MAP_FORGE_SOLLUMZ=' + str(hasattr(bpy.ops, 'sollumz') and hasattr(bpy.ops.sollumz, 'export_assets')))",
            ],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
            env=os.environ.copy(),
        )
    except Exception as exc:
        return False, str(exc)

    combined = f"{process.stdout}\n{process.stderr}"
    if process.returncode != 0:
        return False, combined[-2000:]
    if "MAP_FORGE_SOLLUMZ=True" not in combined:
        return False, "Sollumz não está habilitado no Blender do worker."
    return True, "ready"


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": app.version,
        "maxConcurrent": MAX_CONCURRENT,
        "jobsRoot": str(ROOT),
    }


@app.get("/ready")
def ready(_: None = Depends(require_token)) -> dict[str, Any]:
    started = time.monotonic()
    ok, detail = blender_readiness()
    if not ok:
        raise HTTPException(status_code=503, detail=detail)
    return {"ok": True, "blender": BLENDER, "sollumz": True, "checkedInMs": round((time.monotonic() - started) * 1000)}


@app.post("/v1/exports", status_code=202)
def create_export(request: ExportRequest, _: None = Depends(require_token)) -> dict[str, Any]:
    scene_model = request.scene
    if scene_model.sourceModel and scene_model.sourceModel.status in {"pending", "running"}:
        raise HTTPException(status_code=409, detail="Modelo 3D ainda está sendo gerado.")
    scene = scene_model.model_dump(mode="json")

    job_id = str(uuid.uuid4())
    directory = ROOT / job_id
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=2), encoding="utf-8")
    write_status(job_id, "queued", 10)
    threading.Thread(target=run_export, args=(job_id,), name=f"export-{job_id[:8]}", daemon=True).start()
    return {"id": job_id, "status": "queued", "progress": 10}


@app.get("/v1/exports/{job_id}")
def get_export(job_id: str, _: None = Depends(require_token)) -> dict[str, Any]:
    normalized = normalize_job_id(job_id)
    path = ROOT / normalized / "status.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Job não encontrado.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("status") == "ready":
        payload["downloadUrl"] = f"/v1/exports/{normalized}/download"
    return payload


@app.get("/v1/exports/{job_id}/download")
def download_export(job_id: str, _: None = Depends(require_token)) -> FileResponse:
    normalized = normalize_job_id(job_id)
    archive = ROOT / normalized / "fivem-map.zip"
    if not archive.exists():
        raise HTTPException(status_code=404, detail="Arquivo ainda não está pronto.")
    return FileResponse(archive, media_type="application/zip", filename=f"fivem-map-{normalized[:8]}.zip")
