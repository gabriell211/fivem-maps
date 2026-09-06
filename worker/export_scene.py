"""Build a SceneSpec in Blender and export a loadable FiveM resource with Sollumz.

Run from Blender:
  blender --background --python worker/export_scene.py -- scene.json ./output

Requirements:
- Blender 4.2+
- Sollumz installed and enabled
- Sollumz native exporter dependencies available
"""
from __future__ import annotations

import importlib
import json
import math
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

import bpy

MAX_MODEL_BYTES = 180 * 1024 * 1024
SLOYD_MODEL_BASE = "https://storage.googleapis.com/ai-services-quality/jobs"


def args_after_double_dash() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def safe_asset_name(value: object) -> str:
    name = re.sub(r"[^a-z0-9_]+", "_", str(value or "generated_map").lower()).strip("_")
    return name[:48] or "generated_map"


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image.name != "Render Result":
            bpy.data.images.remove(image)


def verify_sollumz() -> None:
    required = (
        "converttodrawable",
        "autoconvertmaterials",
        "setallmatembedded",
        "createytyp",
        "createarchetypefromselected",
        "export_assets",
    )
    if not hasattr(bpy.ops, "sollumz"):
        raise RuntimeError("Sollumz não está instalado/ativado neste Blender.")
    missing = [name for name in required if not hasattr(bpy.ops.sollumz, name)]
    if missing:
        raise RuntimeError(f"Sollumz incompatível: operadores ausentes: {', '.join(missing)}")


def find_sollumz_module_root() -> str:
    candidates: list[str] = []
    for module_name in list(sys.modules):
        if module_name in {"sollumz", "sollumz_dev"} or module_name.endswith(".sollumz") or module_name.endswith(".sollumz_dev"):
            candidates.append(module_name)
    for module_name in sorted(candidates, key=len):
        try:
            importlib.import_module(f"{module_name}.ymap_next.properties.map")
            return module_name
        except ModuleNotFoundError:
            continue
    raise RuntimeError("Não foi possível localizar o módulo Python do Sollumz carregado.")


def hex_to_rgba(value: str) -> tuple[float, float, float, float]:
    clean = value.lstrip("#")
    if len(clean) != 6:
        return (0.5, 0.5, 0.5, 1.0)
    try:
        return tuple(int(clean[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)
    except ValueError:
        return (0.5, 0.5, 0.5, 1.0)


def material_for(name: str, color: str) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = hex_to_rgba(color)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF") if material.node_tree else None
    if principled:
        principled.inputs["Base Color"].default_value = material.diffuse_color
        principled.inputs["Roughness"].default_value = 0.72
    return material


def add_mesh(item: dict[str, Any]) -> bpy.types.Object:
    primitive = item.get("primitive", "box")
    if primitive == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.5, depth=1)
    elif primitive == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.5)
    elif primitive == "plane":
        bpy.ops.mesh.primitive_plane_add(size=1)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1)

    mesh = bpy.context.active_object
    if mesh is None or mesh.type != "MESH":
        raise RuntimeError("Blender não criou a geometria procedural esperada.")
    mesh.name = safe_asset_name(item.get("name") or item.get("id") or "generated_asset")
    mesh.location = tuple(float(v) for v in item.get("position", [0, 0, 0]))
    mesh.rotation_euler = tuple(math.radians(float(v)) for v in item.get("rotation", [0, 0, 0]))
    mesh.scale = tuple(float(v) for v in item.get("scale", [1, 1, 1]))
    mesh.data.materials.append(material_for(str(item.get("material") or "generated"), str(item.get("color") or "#808080")))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return mesh


def download_sloyd_glb(source: dict[str, Any], directory: Path) -> Path | None:
    if source.get("provider") != "sloyd" or source.get("status") != "success":
        return None
    job_id = str(source.get("jobId") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", job_id):
        raise RuntimeError("jobId do modelo Sloyd é inválido.")

    url = f"{SLOYD_MODEL_BASE}/{job_id}.glb"
    path = directory / "source.glb"
    request = urllib.request.Request(url, headers={"User-Agent": "FiveM-Map-Forge/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response, path.open("wb") as output:
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
        raise RuntimeError(f"Falha ao baixar o GLB gerado: {exc}") from exc

    if path.stat().st_size < 1024:
        raise RuntimeError("GLB gerado está vazio ou inválido.")
    return path


def import_glb(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    result = bpy.ops.import_scene.gltf(filepath=str(path))
    if "FINISHED" not in result:
        raise RuntimeError("Blender falhou ao importar o GLB gerado.")
    meshes = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("O GLB não contém nenhuma malha utilizável.")
    return meshes


def build_procedural_meshes(scene: dict[str, Any]) -> list[bpy.types.Object]:
    meshes = [add_mesh(item) for item in scene.get("objects", []) if item.get("kind") != "light"]
    if not meshes:
        raise RuntimeError("SceneSpec não possui geometria para exportar.")
    return meshes


def join_meshes(meshes: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    valid = [obj for obj in meshes if obj and obj.type == "MESH"]
    if not valid:
        raise RuntimeError("Nenhuma malha válida para unir.")
    for obj in valid:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = valid[0]
    if len(valid) > 1:
        result = bpy.ops.object.join()
        if "FINISHED" not in result:
            raise RuntimeError("Falha ao consolidar as malhas do mapa.")
    mesh = bpy.context.active_object
    if mesh is None or mesh.type != "MESH":
        raise RuntimeError("A consolidação do mapa não produziu uma malha.")
    mesh.name = name
    return mesh


def prepare_materials(mesh: bpy.types.Object) -> None:
    if not mesh.data.materials:
        mesh.data.materials.append(material_for("generated", "#808080"))
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    result = bpy.ops.sollumz.autoconvertmaterials()
    if "FINISHED" not in result:
        raise RuntimeError("Sollumz falhou ao converter os materiais para shaders GTA V.")
    result = bpy.ops.sollumz.setallmatembedded()
    if "FINISHED" not in result:
        raise RuntimeError("Sollumz falhou ao marcar as texturas como embutidas.")


def convert_to_drawable(mesh: bpy.types.Object, name: str) -> bpy.types.Object:
    bpy.context.scene.create_seperate_drawables = True
    bpy.context.scene.auto_create_embedded_col = True
    bpy.context.scene.center_drawable_to_selection = False
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    result = bpy.ops.sollumz.converttodrawable()
    if "FINISHED" not in result:
        raise RuntimeError("Sollumz não conseguiu converter a cena para Drawable.")
    drawable = mesh.parent
    if drawable is None:
        raise RuntimeError("Drawable pai não foi criado.")
    drawable.name = name
    return drawable


def create_ytyp(drawable: bpy.types.Object, name: str) -> None:
    result = bpy.ops.sollumz.createytyp()
    if "FINISHED" not in result:
        raise RuntimeError("Falha ao criar YTYP.")
    if not bpy.context.scene.ytyps:
        raise RuntimeError("YTYP não foi registrado na cena.")
    ytyp = bpy.context.scene.ytyps[bpy.context.scene.ytyp_index]
    ytyp.name = name
    bpy.context.scene.create_archetype_type = "sollumz_archetype_base"

    bpy.ops.object.select_all(action="DESELECT")
    drawable.select_set(True)
    bpy.context.view_layer.objects.active = drawable
    result = bpy.ops.sollumz.createarchetypefromselected()
    if "FINISHED" not in result or not ytyp.archetypes:
        raise RuntimeError("Falha ao criar archetype do Drawable no YTYP.")


def create_current_ymap(drawable: bpy.types.Object, name: str) -> None:
    root = find_sollumz_module_root()
    map_module = importlib.import_module(f"{root}.ymap_next.properties.map")
    extents_module = importlib.import_module(f"{root}.ymap_next.extents")

    maps = map_module.get_maps(bpy.context, create_if_missing=True)
    if maps is None:
        raise RuntimeError("Sollumz não conseguiu inicializar o sistema YMAP atual.")

    group = maps.new_group()
    group.name = name
    map_data = group.new_map()
    map_data.name = name
    group.maps.select(0)

    entity = group.new_entity()
    entity.archetype_name = drawable.name.lower()
    entity.linked_object = drawable
    entity.map_data_uuid = map_data.uuid
    transform = drawable.matrix_world
    location, rotation, scale = transform.decompose()
    entity.position = location
    entity.rotation = rotation
    entity.scale_xy = scale.x
    entity.scale_z = scale.z
    entity.lod_dist = -1.0
    group.entities.select(0)

    updated = extents_module.update_maps_extents(group, [map_data.uuid])
    if updated != 1:
        raise RuntimeError("Sollumz não conseguiu calcular os extents do YMAP.")


def export_native_assets(output_dir: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    result = bpy.ops.sollumz.export_assets(
        directory=str(output_dir),
        direct_export=True,
        use_custom_settings=True,
        target_formats={"NATIVE"},
        target_versions={"GEN8"},
        limit_to_selected=False,
        exclude_skeleton=False,
        apply_transforms=False,
        mesh_domain="FACE_CORNER",
        export_ytyps=True,
        export_ytyps_include="ALL",
        export_ymaps=True,
        export_ymaps_include="ALL",
        export_ytds=False,
        export_ytds_include="ALL",
    )
    if "FINISHED" not in result:
        raise RuntimeError(
            "Sollumz falhou ao exportar NATIVE/GEN8. Confirme que as dependências do exportador binário estão instaladas."
        )


def collect_native_files(output_dir: Path) -> list[Path]:
    extensions = {".ydr", ".ybn", ".ytd", ".ytyp", ".ymap"}
    files = [p for p in output_dir.rglob("*") if p.is_file() and p.suffix.lower() in extensions]
    produced = {p.suffix.lower() for p in files}
    required = {".ydr", ".ytyp", ".ymap"}
    missing = sorted(required - produced)
    if missing:
        raise RuntimeError(f"Exportação incompleta: arquivos obrigatórios ausentes: {', '.join(missing)}")
    return files


def package_resource(scene: dict[str, Any], output_dir: Path, files: list[Path]) -> Path:
    resource_dir = output_dir / "fivem_resource"
    stream_dir = resource_dir / "stream"
    stream_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        destination = stream_dir / file.name
        if destination.exists():
            destination.unlink()
        file.replace(destination)

    (resource_dir / "fxmanifest.lua").write_text(
        "fx_version 'cerulean'\n"
        "game 'gta5'\n\n"
        "author 'FiveM Map Forge'\n"
        "description 'AI-generated FiveM map'\n"
        "version '1.0.0'\n"
        "this_is_a_map 'yes'\n",
        encoding="utf-8",
    )
    (resource_dir / "scene.json").write_text(json.dumps(scene, indent=2, ensure_ascii=False), encoding="utf-8")
    return resource_dir


def export_scene(scene: dict[str, Any], output_dir: Path) -> None:
    verify_sollumz()
    reset_scene()
    output_dir.mkdir(parents=True, exist_ok=True)
    name = safe_asset_name(scene.get("name"))

    source = scene.get("sourceModel")
    glb_path = download_sloyd_glb(source, output_dir) if isinstance(source, dict) else None
    meshes = import_glb(glb_path) if glb_path else build_procedural_meshes(scene)
    mesh = join_meshes(meshes, name)
    prepare_materials(mesh)
    drawable = convert_to_drawable(mesh, name)
    create_ytyp(drawable, name)
    create_current_ymap(drawable, name)

    blend_path = output_dir / f"{name}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    export_native_assets(output_dir)
    native_files = collect_native_files(output_dir)
    package_resource(scene, output_dir, native_files)


def main() -> None:
    args = args_after_double_dash()
    if len(args) != 2:
        raise SystemExit("Uso: blender --background --python worker/export_scene.py -- scene.json output_dir")

    scene_path = Path(args[0]).resolve()
    output_dir = Path(args[1]).resolve()
    with scene_path.open("r", encoding="utf-8") as handle:
        scene = json.load(handle)
    if not isinstance(scene, dict) or not scene.get("name") or not isinstance(scene.get("objects"), list):
        raise RuntimeError("SceneSpec inválida.")
    export_scene(scene, output_dir)


if __name__ == "__main__":
    main()
