import { randomUUID } from "crypto";
import type { SceneObject, SceneSpec } from "./scene-schema";

const COLORS = {
  concrete: "#858585",
  asphalt: "#2f3133",
  glass: "#86a7c7",
  grass: "#557a3d",
  brick: "#70554d",
  metal: "#515963",
  water: "#3d7294",
};

function object(input: Omit<SceneObject, "id">): SceneObject {
  return { id: randomUUID(), ...input };
}

function detectStyle(prompt: string): SceneSpec["style"] {
  const p = prompt.toLowerCase();
  if (p.includes("abandon")) return "abandoned";
  if (p.includes("industrial") || p.includes("galp")) return "industrial";
  if (p.includes("lux") || p.includes("mansão") || p.includes("mansao")) return "luxury";
  if (p.includes("fazenda") || p.includes("rural")) return "rural";
  if (p.includes("moderno") || p.includes("modern")) return "modern";
  if (p.includes("realista") || p.includes("realistic")) return "realistic";
  return "custom";
}

function addParking(objects: SceneObject[], width = 34, depth = 22): void {
  objects.push(object({
    name: "Parking lot",
    kind: "road",
    primitive: "box",
    position: [0, -18, 0.05],
    rotation: [0, 0, 0],
    scale: [width, depth, 0.1],
    color: COLORS.asphalt,
    material: "asphalt",
    collision: true,
  }));

  for (let x = -12; x <= 12; x += 4) {
    objects.push(object({
      name: "Parking divider",
      kind: "prop",
      primitive: "box",
      position: [x, -18, 0.12],
      rotation: [0, 0, 0],
      scale: [0.08, 4.4, 0.02],
      color: "#dedede",
      collision: false,
    }));
  }
}

function addBuilding(objects: SceneObject[], prompt: string): void {
  const p = prompt.toLowerCase();
  const isHospital = p.includes("hospital") || p.includes("clinica") || p.includes("clínica");
  const isPolice = p.includes("delegacia") || p.includes("policia") || p.includes("polícia");
  const isMansion = p.includes("mansão") || p.includes("mansao") || p.includes("mansion");

  const width = isMansion ? 30 : 38;
  const depth = isHospital ? 28 : 24;
  const height = isHospital ? 12 : 9;

  objects.push(object({
    name: isHospital ? "Hospital shell" : isPolice ? "Police station shell" : isMansion ? "Mansion shell" : "Main building",
    kind: "building",
    primitive: "box",
    position: [0, 5, height / 2],
    rotation: [0, 0, 0],
    scale: [width, depth, height],
    color: p.includes("abandon") ? COLORS.brick : COLORS.concrete,
    material: p.includes("abandon") ? "weathered_concrete" : "concrete",
    collision: true,
  }));

  objects.push(object({
    name: "Glass entrance",
    kind: "prop",
    primitive: "box",
    position: [0, 5 - depth / 2 - 0.08, 2.5],
    rotation: [0, 0, 0],
    scale: [6, 0.12, 5],
    color: COLORS.glass,
    material: "glass",
    collision: true,
  }));

  if (isHospital || p.includes("interior") || p.includes("corredor")) {
    for (let x = -12; x <= 12; x += 8) {
      objects.push(object({
        name: "Interior partition",
        kind: "wall",
        primitive: "box",
        position: [x, 5, 3],
        rotation: [0, 0, 0],
        scale: [0.2, depth - 3, 6],
        color: "#d8d7d1",
        material: "plaster",
        collision: true,
      }));
    }
  }
}

function addEnvironment(objects: SceneObject[], prompt: string): void {
  objects.push(object({
    name: "Ground",
    kind: "floor",
    primitive: "box",
    position: [0, 0, -0.3],
    rotation: [0, 0, 0],
    scale: [90, 90, 0.6],
    color: prompt.toLowerCase().includes("cidade") ? COLORS.concrete : COLORS.grass,
    material: "terrain",
    collision: true,
  }));

  if (prompt.toLowerCase().includes("água") || prompt.toLowerCase().includes("agua") || prompt.toLowerCase().includes("lago")) {
    objects.push(object({
      name: "Water feature",
      kind: "water",
      primitive: "box",
      position: [28, 12, 0.05],
      rotation: [0, 0, 0],
      scale: [22, 18, 0.1],
      color: COLORS.water,
      material: "water",
      collision: false,
    }));
  }
}

export function planScene(prompt: string): SceneSpec {
  const normalized = prompt.trim();
  if (normalized.length < 8) {
    throw new Error("Descreva o mapa com pelo menos 8 caracteres.");
  }

  const objects: SceneObject[] = [];
  addEnvironment(objects, normalized);
  addBuilding(objects, normalized);

  const p = normalized.toLowerCase();
  if (p.includes("estacion") || p.includes("hospital") || p.includes("delegacia")) addParking(objects);

  if (p.includes("luz") || p.includes("ilumina")) {
    for (const x of [-12, 0, 12]) {
      objects.push(object({
        name: "Exterior light",
        kind: "light",
        primitive: "cylinder",
        position: [x, -8, 2.5],
        rotation: [0, 0, 0],
        scale: [0.25, 0.25, 5],
        color: p.includes("vermelh") ? "#d54444" : "#f3df9c",
        collision: true,
      }));
    }
  }

  return {
    id: randomUUID(),
    name: normalized.slice(0, 48),
    prompt: normalized,
    style: detectStyle(normalized),
    spawn: [0, -32, 1],
    objects,
    metadata: {
      estimatedEntities: objects.length,
      estimatedDrawCalls: Math.max(1, Math.ceil(objects.length * 0.65)),
      hasInterior: p.includes("interior") || p.includes("hospital") || p.includes("corredor"),
      generatedAt: new Date().toISOString(),
    },
  };
}
