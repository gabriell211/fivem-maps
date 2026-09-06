"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, Grid, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import type { SceneObject, SceneSpec } from "@/lib/scene-schema";

function Primitive({ item }: { item: SceneObject }) {
  const position: [number, number, number] = item.position;
  const rotation: [number, number, number] = item.rotation;
  const scale: [number, number, number] = item.scale;

  return (
    <mesh position={position} rotation={rotation} scale={scale} castShadow receiveShadow>
      {item.primitive === "box" && <boxGeometry args={[1, 1, 1]} />}
      {item.primitive === "cylinder" && <cylinderGeometry args={[0.5, 0.5, 1, 24]} />}
      {item.primitive === "sphere" && <sphereGeometry args={[0.5, 24, 24]} />}
      {item.primitive === "plane" && <planeGeometry args={[1, 1]} />}
      <meshStandardMaterial
        color={item.color}
        roughness={item.material === "glass" ? 0.12 : 0.72}
        metalness={item.material === "metal" ? 0.65 : 0.05}
        transparent={item.material === "glass"}
        opacity={item.material === "glass" ? 0.58 : 1}
      />
    </mesh>
  );
}

function GeneratedModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const clonedScene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  return (
    <Bounds fit clip observe margin={1.2}>
      <Center bottom>
        <primitive object={clonedScene} castShadow receiveShadow />
      </Center>
    </Bounds>
  );
}

export function ScenePreview({ scene, modelUrl }: { scene: SceneSpec | null; modelUrl?: string | null }) {
  return (
    <div className="preview-shell" aria-label="Prévia 3D do mapa">
      <Canvas shadows dpr={[1, 1.7]}>
        <color attach="background" args={["#071019"]} />
        <fog attach="fog" args={["#071019", 70, 170]} />
        <PerspectiveCamera makeDefault position={[54, -62, 42]} fov={48} />
        <ambientLight intensity={1.2} />
        <directionalLight castShadow position={[24, -20, 44]} intensity={2.1} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        {modelUrl ? (
          <Suspense fallback={null}>
            <GeneratedModel url={modelUrl} />
          </Suspense>
        ) : (
          scene?.objects.map((item) => <Primitive key={item.id} item={item} />)
        )}
        <Grid infiniteGrid fadeDistance={120} sectionSize={10} cellSize={1} sectionThickness={1.1} cellThickness={0.35} position={[0, 0, 0.02]} />
        <OrbitControls makeDefault minDistance={2} maxDistance={180} maxPolarAngle={Math.PI / 2.03} />
      </Canvas>
      {!scene && (
        <div className="preview-empty">
          <span className="eyebrow">PREVIEW ENGINE</span>
          <strong>Seu mapa vai aparecer aqui</strong>
          <p>Escreva o que quer construir. A cena será planejada e renderizada em 3D.</p>
        </div>
      )}
    </div>
  );
}
