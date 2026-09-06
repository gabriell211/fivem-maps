"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Center, ContactShadows, Grid, OrbitControls, PerspectiveCamera, Sky, useGLTF } from "@react-three/drei";
import type { SceneObject, SceneSpec } from "@/lib/scene-schema";

const degToRad = (degrees: number) => degrees * Math.PI / 180;

function Primitive({ item }: { item: SceneObject }) {
  const position: [number, number, number] = item.position;
  const rotation: [number, number, number] = item.rotation.map(degToRad) as [number, number, number];
  const scale: [number, number, number] = item.scale;

  return (
    <mesh position={position} rotation={rotation} scale={scale} castShadow receiveShadow>
      {item.primitive === "box" && <boxGeometry args={[1, 1, 1]} />}
      {item.primitive === "cylinder" && <cylinderGeometry args={[0.5, 0.5, 1, 24]} />}
      {item.primitive === "sphere" && <sphereGeometry args={[0.5, 24, 24]} />}
      {item.primitive === "plane" && <planeGeometry args={[1, 1]} />}
      <meshStandardMaterial
        color={item.color}
        roughness={item.material === "glass" ? 0.08 : item.material === "metal" ? 0.32 : 0.76}
        metalness={item.material === "metal" ? 0.68 : 0.02}
        transparent={item.material === "glass"}
        opacity={item.material === "glass" ? 0.5 : 1}
      />
    </mesh>
  );
}

function GeneratedModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const clonedScene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  return (
    <Bounds fit clip observe margin={1.18}>
      <Center bottom>
        <primitive object={clonedScene} castShadow receiveShadow />
      </Center>
    </Bounds>
  );
}

export function ScenePreview({ scene, modelUrl }: { scene: SceneSpec | null; modelUrl?: string | null }) {
  const isBlockout = Boolean(scene && !modelUrl);

  return (
    <div className="preview-shell" aria-label="Prévia 3D do mapa">
      <Canvas shadows dpr={[1, 1.6]}>
        <color attach="background" args={["#090f16"]} />
        <fog attach="fog" args={["#0b131c", 85, 220]} />
        <PerspectiveCamera makeDefault position={[56, -66, 38]} fov={46} />
        <Sky distance={450000} sunPosition={[80, -50, 95]} inclination={0.53} azimuth={0.23} turbidity={6} rayleigh={1.7} />
        <hemisphereLight intensity={0.8} groundColor="#17202a" />
        <directionalLight castShadow position={[36, -34, 62]} intensity={2.8} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        {modelUrl ? (
          <Suspense fallback={null}>
            <GeneratedModel url={modelUrl} />
          </Suspense>
        ) : (
          scene?.objects.map((item) => <Primitive key={item.id} item={item} />)
        )}
        <ContactShadows position={[0, 0, 0.02]} opacity={0.38} scale={120} blur={2.2} far={55} />
        <Grid infiniteGrid fadeDistance={150} sectionSize={10} cellSize={1} sectionThickness={1} cellThickness={0.28} position={[0, 0, 0.025]} />
        <OrbitControls makeDefault minDistance={2} maxDistance={220} maxPolarAngle={Math.PI / 2.02} />
      </Canvas>

      {isBlockout && (
        <div className="blockout-banner" role="status">
          <span>BLOCKOUT DE PLANEJAMENTO</span>
          <strong>Isso não é o mapa final.</strong>
          <small>A geometria simples serve apenas para organizar escala, áreas e posição enquanto o modelo 3D real é gerado.</small>
        </div>
      )}

      {!scene && (
        <div className="preview-empty">
          <span className="eyebrow">PREVIEW 3D</span>
          <strong>O mapa profissional vai aparecer aqui</strong>
          <p>Descreva o cenário. Primeiro montamos o plano espacial; depois o modelo 3D real substitui o blockout.</p>
        </div>
      )}
    </div>
  );
}
