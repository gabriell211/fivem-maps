import * as v from "valibot";

export const Vec3Schema = v.tuple([v.number(), v.number(), v.number()]);

export const SceneObjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  kind: v.picklist(["building", "road", "wall", "floor", "prop", "light", "vegetation", "water"]),
  primitive: v.picklist(["box", "cylinder", "plane", "sphere"]),
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema,
  color: v.string(),
  material: v.optional(v.string()),
  gtaAsset: v.optional(v.string()),
  collision: v.boolean(),
});

export const SourceModelSchema = v.object({
  provider: v.picklist(["tripo", "trellis", "sloyd"]),
  jobId: v.string(),
  status: v.picklist(["pending", "running", "success", "error"]),
  progress: v.optional(v.number()),
  url: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const SceneSpecSchema = v.object({
  id: v.string(),
  name: v.string(),
  prompt: v.string(),
  style: v.picklist(["realistic", "modern", "industrial", "abandoned", "luxury", "rural", "custom"]),
  worldPosition: Vec3Schema,
  spawn: Vec3Schema,
  objects: v.array(SceneObjectSchema),
  sourceModel: v.optional(SourceModelSchema),
  metadata: v.object({
    estimatedEntities: v.number(),
    estimatedDrawCalls: v.number(),
    hasInterior: v.boolean(),
    generatedAt: v.string(),
  }),
});

export type SceneSpec = v.InferOutput<typeof SceneSpecSchema>;
export type SceneObject = v.InferOutput<typeof SceneObjectSchema>;
export type SourceModel = v.InferOutput<typeof SourceModelSchema>;

export function parseSceneSpec(input: unknown): SceneSpec {
  return v.parse(SceneSpecSchema, input);
}
