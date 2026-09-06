"""Tripo-aware entrypoint for the existing Blender/Sollumz exporter.

The Tripo model URLs expire quickly, so the worker refreshes the task output
using TRIPO_API_KEY immediately before Blender downloads the PBR GLB.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any

import export_scene as exporter

TRIPO_TASK_BASE = "https://api.tripo3d.ai/v2/openapi/task"
MAX_MODEL_BYTES = exporter.MAX_MODEL_BYTES


def tripo_api_key() -> str:
    key = os.getenv("TRIPO_API_KEY", "").strip()
    if not key:
        raise RuntimeError("TRIPO_API_KEY não está configurada no worker Blender/Sollumz.")
    return key


def get_fresh_model_url(job_id: str) -> str:
    request = urllib.request.Request(
        f"{TRIPO_TASK_BASE}/{job_id}",
        headers={
            "Authorization": f"Bearer {tripo_api_key()}",
            "User-Agent": "FiveM-Map-Forge/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Falha ao consultar tarefa Tripo no worker: {exc}") from exc

    if not isinstance(payload, dict) or payload.get("code") != 0:
        raise RuntimeError(str(payload.get("message") if isinstance(payload, dict) else "Resposta inválida da Tripo."))

    data = payload.get("data")
    if not isinstance(data, dict) or data.get("status") != "success":
        raise RuntimeError(f"Tarefa Tripo não está concluída: {data.get('status') if isinstance(data, dict) else 'unknown'}")

    output = data.get("output")
    if not isinstance(output, dict):
        raise RuntimeError("A Tripo concluiu a tarefa sem output de modelo.")

    model_url = output.get("pbr_model") or output.get("model")
    if not isinstance(model_url, str) or not model_url.startswith("https://"):
        raise RuntimeError("A Tripo não retornou URL PBR/GLB válida.")
    return model_url


def download_tripo_glb(source: dict[str, Any], directory: Path) -> Path:
    if source.get("provider") != "tripo" or source.get("status") != "success":
        raise RuntimeError("A exportação final exige um modelo 3D Tripo concluído.")

    job_id = str(source.get("jobId") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", job_id):
        raise RuntimeError("task_id do modelo Tripo é inválido.")

    url = get_fresh_model_url(job_id)
    path = directory / "source.glb"
    request = urllib.request.Request(url, headers={"User-Agent": "FiveM-Map-Forge/1.0"})

    try:
        with urllib.request.urlopen(request, timeout=120) as response, path.open("wb") as output:
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_MODEL_BYTES:
                raise RuntimeError("Modelo 3D excede o limite de 180 MB.")

            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_MODEL_BYTES:
                    raise RuntimeError("Modelo 3D excede o limite de 180 MB.")
                output.write(chunk)
    except Exception as exc:
        raise RuntimeError(f"Falha ao baixar o GLB/PBR da Tripo: {exc}") from exc

    if not path.exists() or path.stat().st_size < 1024:
        raise RuntimeError("GLB/PBR da Tripo está vazio ou inválido.")
    return path


# Reuse all validated Sollumz/YTD/YTYP/YMAP logic, replacing only the provider download.
exporter.download_sloyd_glb = download_tripo_glb


if __name__ == "__main__":
    exporter.main()
