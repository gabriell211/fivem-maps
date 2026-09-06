"""Convert a finished textured AI model into a loadable FiveM map resource.

Run from Blender:
  blender --background --python worker/export_scene.py -- scene.json ./output

Production requirements:
- Blender 4.2+
- Sollumz installed and enabled
- Sollumz native exporter dependencies available
- SceneSpec with sourceModel.status == "success"
- Textured GLB with UVs
"""
from __future__ import annotations

import importlib
import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector

MAX_MODEL_BYTES = 180 * 1024 * 1024
MIN_TEXTURE_EDGE = 1024
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
        "removeallmatembedded",
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
        if (
            module_name in {"sollumz", "sollumz_dev"}
            or module_name.endswith(".sollumz")
            or module_name.endswith(".sollumz_dev")
        ):
            candidates.append(module_name)
    for module_name in sorted(candidates, key=len):
        try:
            importlib.import_module(f"{module_name}.ymap_next.properties.map")
            return module_name
        except ModuleNotFoundError:
            continue
    raise RuntimeError("Não foi possível localizar o módulo Python do Sollumz carregado.")


def download_sloyd_glb(source: dict[str, Any], directory: Path) -> Path:
    if source.get("provider") != "sloyd" or source.get("status") != "success":
        raise RuntimeError("A exportação final exige um modelo 3D Sloyd concluído.")

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

    if not path.exists() or path.stat().st_size < 1024:
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


def images_from_material(material: bpy.types.Material | None) -> list[bpy.types.Image]:
    if material is None or not material.use_nodes or material.node_tree is None:
        return []
    images: list[bpy.types.Image] = []
    for node in material.node_tree.nodes:
        if isinstance(node, bpy.types.ShaderNodeTexImage) and node.image and node.image not in images:
            images.append(node.image)
    return images


def images_from_mesh(mesh: bpy.types.Object) -> list[bpy.types.Image]:
    images: list[bpy.types.Image] = []
    for material in mesh.data.materials:
        for image in images_from_material(material):
            if image not in images:
                images.append(image)
    return images


def validate_textured_source(meshes: list[bpy.types.Object]) -> None:
    total_polygons = 0
    all_images: list[bpy.types.Image] = []
    textured_meshes = 0

    for mesh in meshes:
        total_polygons += len(mesh.data.polygons)
        images = images_from_mesh(mesh)
        if images:
            textured_meshes += 1
            if not mesh.data.uv_layers:
                raise RuntimeError(f"A malha '{mesh.name}' possui texturas, mas não possui UV map.")
            for image in images:
                if image not in all_images:
                    all_images.append(image)

    if total_polygons < 100:
        raise RuntimeError("O modelo 3D final possui geometria insuficiente para ser considerado um mapa detalhado.")
    if textured_meshes == 0 or not all_images:
        raise RuntimeError("O modelo 3D final veio sem texturas. A exportação foi bloqueada.")

    invalid_images = [image.name for image in all_images if min(int(image.size[0]), int(image.size[1])) <= 0]
    if invalid_images:
        raise RuntimeError(f"Texturas inválidas/vazias: {', '.join(invalid_images[:8])}")

    largest_edge = max(max(int(image.size[0]), int(image.size[1])) for image in all_images)
    if largest_edge < MIN_TEXTURE_EDGE:
        raise RuntimeError(
            f"As texturas do modelo estão abaixo de {MIN_TEXTURE_EDGE}px. Gere novamente em qualidade 1K/2K/4K."
        )


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


def target_model_dimensions(scene: dict[str, Any]) -> tuple[float, float, float]:
    objects = scene.get("objects", [])
    candidates = [item for item in objects if item.get("kind") in {"building", "wall"}]
    if not candidates:
        candidates = [item for item in objects if item.get("kind") not in {"floor", "road", "water", "light"}]
    if not candidates:
        return (20.0, 20.0, 8.0)

    mins = [float("inf"), float("inf"), float("inf")]
    maxs = [float("-inf"), float("-inf"), float("-inf")]
    for item in candidates:
        position = [float(v) for v in item.get("position", [0, 0, 0])]
        scale = [abs(float(v)) for v in item.get("scale", [1, 1, 1])]
        for axis in range(3):
            mins[axis] = min(mins[axis], position[axis] - scale[axis] * 0.5)
            maxs[axis] = max(maxs[axis], position[axis] + scale[axis] * 0.5)
    return tuple(max(0.25, maxs[axis] - mins[axis]) for axis in range(3))


def normalize_generated_mesh(mesh: bpy.types.Object, scene: dict[str, Any]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.context.view_layer.update()

    source_dimensions = tuple(max(0.0001, abs(float(v))) for v in mesh.dimensions)
    target_dimensions = target_model_dimensions(scene)
    source_horizontal = max(source_dimensions[0], source_dimensions[1])
    target_horizontal = max(target_dimensions[0], target_dimensions[1])
    factor = max(0.001, min(target_horizontal / source_horizontal, 1000.0))

    mesh.scale = tuple(float(component) * factor for component in mesh.scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.update()

    corners = [mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box]
    min_x = min(corner.x for corner in corners)
    max_x = max(corner.x for corner in corners)
    min_y = min(corner.y for corner in corners)
    max_y = max(corner.y for corner in corners)
    min_z = min(corner.z for corner in corners)
    mesh.location.x -= (min_x + max_x) * 0.5
    mesh.location.y -= (min_y + max_y) * 0.5
    mesh.location.z -= min_z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def prepare_gta_materials(mesh: bpy.types.Object) -> list[bpy.types.Image]:
    if not mesh.data.materials:
        raise RuntimeError("O modelo final não possui materiais.")

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    result = bpy.ops.sollumz.autoconvertmaterials()
    if "FINISHED" not in result:
        raise RuntimeError("Sollumz falhou ao converter materiais PBR para shaders GTA V.")

    images = images_from_mesh(mesh)
    if not images:
        raise RuntimeError("Os shaders GTA foram criados sem nenhuma textura utilizável.")

    for image in images:
        if image.packed_file is None:
            try:
                image.pack()
            except RuntimeError as exc:
                raise RuntimeError(f"Não foi possível empacotar a textura '{image.name}': {exc}") from exc

    result = bpy.ops.sollumz.removeallmatembedded()
    if "FINISHED" not in result:
        raise RuntimeError("Sollumz falhou ao preparar as texturas para o YTD.")

    return images


def create_texture_dictionary(images: list[bpy.types.Image], name: str) -> str:
    txds = getattr(bpy.context.scene, "sz_txds", None)
    if txds is None:
        raise RuntimeError("Sistema YTD do Sollumz não está disponível.")

    txd_name = f"{name}_textures"
    txd = txds.new_texture_dictionary(txd_name)
    for image in images:
        txd.new_texture(image)
    if not txd.textures:
        raise RuntimeError("O YTD foi criado sem texturas.")
    return txd_name


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


def create_ytyp(drawable: bpy.types.Object, name: str, texture_dictionary: str) -> None:
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

    archetype = ytyp.archetypes.active_item
    if archetype is None:
        raise RuntimeError("Archetype ativo não foi criado.")
    archetype.texture_dictionary = texture_dictionary
    archetype.hd_texture_dist = 120.0
    archetype.lod_dist = 350.0


def apply_world_position(drawable: bpy.types.Object, scene: dict[str, Any]) -> None:
    position = scene.get("worldPosition", [0, 0, 0])
    if not isinstance(position, list) or len(position) != 3:
        raise RuntimeError("worldPosition inválida.")
    drawable.location = tuple(float(v) for v in position)
    bpy.context.view_layer.update()


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
    entity.lod_dist = 350.0
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
        export_ytds=True,
        export_ytds_include="ALL",
    )
    if "FINISHED" not in result:
        raise RuntimeError(
            "Sollumz falhou ao exportar NATIVE/GEN8. Confirme PyMateria e as dependências do exportador binário."
        )


def collect_native_files(output_dir: Path) -> list[Path]:
    extensions = {".ydr", ".ybn", ".ytd", ".ytyp", ".ymap"}
    files = [p for p in output_dir.rglob("*") if p.is_file() and p.suffix.lower() in extensions]
    produced = {p.suffix.lower() for p in files}
    required = {".ydr", ".ytd", ".ytyp", ".ymap"}
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
        "description 'AI-generated textured FiveM map'\n"
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
    if not isinstance(source, dict) or source.get("status") != "success":
        raise RuntimeError("SceneSpec não possui modelo 3D final pronto. Blockout não pode ser exportado.")

    glb_path = download_sloyd_glb(source, output_dir)
    meshes = import_glb(glb_path)
    validate_textured_source(meshes)
    mesh = join_meshes(meshes, name)
    normalize_generated_mesh(mesh, scene)

    images = prepare_gta_materials(mesh)
    texture_dictionary = create_texture_dictionary(images, name)
    drawable = convert_to_drawable(mesh, name)
    create_ytyp(drawable, name, texture_dictionary)
    apply_world_position(drawable, scene)
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
    if (
        not isinstance(scene, dict)
        or not scene.get("name")
        or not isinstance(scene.get("objects"), list)
        or not isinstance(scene.get("worldPosition"), list)
    ):
        raise RuntimeError("SceneSpec inválida.")
    export_scene(scene, output_dir)


if __name__ == "__main__":
    main()
