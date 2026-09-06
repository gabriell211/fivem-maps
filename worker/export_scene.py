"""Build a SceneSpec inside Blender and hand the result to Sollumz.

Run from Blender:
  blender --background --python worker/export_scene.py -- scene.json ./output

Sollumz must be installed and enabled in that Blender installation.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import bpy


def args_after_double_dash() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def hex_to_rgba(value: str) -> tuple[float, float, float, float]:
    clean = value.lstrip("#")
    if len(clean) != 6:
        return (0.5, 0.5, 0.5, 1.0)
    return tuple(int(clean[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


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
    assert mesh is not None
    mesh.name = str(item.get("name") or item.get("id") or "generated_asset")
    mesh.location = tuple(float(v) for v in item.get("position", [0, 0, 0]))
    mesh.rotation_euler = tuple(math.radians(float(v)) for v in item.get("rotation", [0, 0, 0]))
    mesh.scale = tuple(float(v) for v in item.get("scale", [1, 1, 1]))
    mesh.data.materials.append(material_for(str(item.get("material") or "generated"), str(item.get("color") or "#808080")))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return mesh


def verify_sollumz() -> None:
    if not hasattr(bpy.ops, "sollumz"):
        raise RuntimeError("Sollumz não está instalado/ativado neste Blender.")
    if not hasattr(bpy.ops.sollumz, "converttodrawable") or not hasattr(bpy.ops.sollumz, "export_assets"):
        raise RuntimeError("A instalação do Sollumz não expõe os operadores esperados.")


def convert_to_drawable(mesh: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    result = bpy.ops.sollumz.converttodrawable()
    if "FINISHED" not in result:
        raise RuntimeError(f"Sollumz não conseguiu converter {mesh.name} para Drawable.")
    drawable = mesh.parent
    if drawable is None:
        raise RuntimeError(f"Drawable pai não foi criado para {mesh.name}.")
    return drawable


def create_ymap(name: str) -> tuple[bpy.types.Object, bpy.types.Object]:
    bpy.ops.object.select_all(action="DESELECT")
    if "FINISHED" not in bpy.ops.sollumz.createymap():
        raise RuntimeError("Falha ao criar YMAP com Sollumz.")
    ymap = bpy.context.active_object
    if ymap is None:
        raise RuntimeError("YMAP não ficou ativo após criação.")
    ymap.name = name

    if "FINISHED" not in bpy.ops.sollumz.create_entity_group():
        raise RuntimeError("Falha ao criar grupo de entidades YMAP.")
    group = bpy.context.active_object
    if group is None:
        raise RuntimeError("Grupo Entities não ficou ativo.")
    return ymap, group


def export_scene(scene: dict[str, Any], output_dir: Path) -> None:
    verify_sollumz()
    reset_scene()
    output_dir.mkdir(parents=True, exist_ok=True)

    safe_name = "".join(c.lower() if c.isalnum() else "_" for c in str(scene.get("name") or "generated_map")).strip("_")
    safe_name = safe_name[:48] or "generated_map"
    ymap, entities = create_ymap(safe_name)

    drawables: list[bpy.types.Object] = []
    for item in scene.get("objects", []):
        if item.get("kind") == "light":
            continue
        drawable = convert_to_drawable(add_mesh(item))
        drawable.parent = entities
        drawables.append(drawable)

    bpy.ops.object.select_all(action="DESELECT")
    ymap.select_set(True)
    for drawable in drawables:
        drawable.select_set(True)
    bpy.context.view_layer.objects.active = ymap

    if hasattr(bpy.ops.sollumz, "generate_ymap_extents"):
        try:
            bpy.ops.sollumz.generate_ymap_extents()
        except RuntimeError:
            pass

    blend_path = output_dir / f"{safe_name}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    result = bpy.ops.sollumz.export_assets(directory=str(output_dir), direct_export=True)
    if "FINISHED" not in result:
        raise RuntimeError("Sollumz falhou ao exportar os assets RAGE.")

    resource_dir = output_dir / "fivem_resource"
    stream_dir = resource_dir / "stream"
    stream_dir.mkdir(parents=True, exist_ok=True)

    for file in output_dir.iterdir():
        if file.is_file() and file.suffix.lower() in {".ydr", ".ybn", ".ytd", ".ytyp", ".ymap"}:
            file.replace(stream_dir / file.name)

    (resource_dir / "fxmanifest.lua").write_text(
        "fx_version 'cerulean'\n"
        "game 'gta5'\n\n"
        "author 'FiveM Map Forge'\n"
        "description 'Generated map resource'\n"
        "version '1.0.0'\n"
        "this_is_a_map 'yes'\n",
        encoding="utf-8",
    )
    (resource_dir / "scene.json").write_text(json.dumps(scene, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    args = args_after_double_dash()
    if len(args) != 2:
        raise SystemExit("Uso: blender --background --python worker/export_scene.py -- scene.json output_dir")

    scene_path = Path(args[0]).resolve()
    output_dir = Path(args[1]).resolve()
    with scene_path.open("r", encoding="utf-8") as handle:
        scene = json.load(handle)
    export_scene(scene, output_dir)


if __name__ == "__main__":
    main()
