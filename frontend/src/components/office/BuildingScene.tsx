"use client";

import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useMemo, useState } from "react";
import * as THREE from "three";
import { useOfficeStore } from "@/src/store/useOfficeStore";

function BuildingModel() {
  const gltf = useGLTF("/models/props/london_office_building.glb");
  const model = useMemo(() => {
    // We want to center the building
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    
    // Scale and position adjustments
    gltf.scene.position.set(-center.x, -box.min.y, -center.z);
    
    // Make sure it casts and receives shadows
    gltf.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    return gltf.scene;
  }, [gltf.scene]);

  return <primitive object={model} scale={1.0} />;
}

// 7 Floors logic - Increased height and shifted higher up the building
const FLOORS = [
  { id: 1, name: "Lobby", height: 2.8, yPos: 3.5 },
  { id: 2, name: "Human Resources", height: 2.8, yPos: 6.4 },
  { id: 3, name: "Administration", height: 2.8, yPos: 9.3 },
  { id: 4, name: "Engineering", height: 2.8, yPos: 12.2 },
  { id: 5, name: "Marketing", height: 2.8, yPos: 15.1 },
  { id: 6, name: "Sales", height: 2.8, yPos: 18.0 },
  { id: 7, name: "Executive Floor", height: 3.0, yPos: 21.0 },
];

function FloorHitboxes() {
  const [hoveredFloor, setHoveredFloor] = useState<number | null>(null);
  const { isLoggedIn, setViewMode, setSelectedFloor } = useOfficeStore();

  return (
    <group position={[0, 0, 0]}>
      {FLOORS.map((floor) => {
        const isHovered = hoveredFloor === floor.id;
        
        return (
          <group key={floor.id} position={[0, floor.yPos, 0]}>
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                setHoveredFloor(floor.id);
              }}
              onPointerOut={() => setHoveredFloor(null)}
              onClick={(e) => {
                e.stopPropagation();
                if (isLoggedIn) {
                  setSelectedFloor(floor.id);
                  setViewMode("office");
                }
              }}
            >
              {/* Box geometry covering the approximate floor area */}
              <boxGeometry args={[10, floor.height, 10]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            {isHovered && (
              <>
                {/* Visual Highlight */}
                <mesh position={[0, 0, 0]} receiveShadow={false} castShadow={false}>
                  <boxGeometry args={[10.2, floor.height - 0.1, 10.2]} />
                  <meshBasicMaterial color="#34d399" transparent opacity={0.2} side={THREE.BackSide} />
                </mesh>

                {/* HTML Tooltip */}
                <Html position={[0, 0, 5.5]} center className="pointer-events-none">
                  <div className="flex flex-col items-center rounded-lg border border-emerald-500/30 bg-slate-950/90 px-4 py-2 text-center shadow-lg backdrop-blur-md">
                    <span className="text-xs font-bold text-emerald-400">FLOOR {floor.id}</span>
                    <span className="text-sm font-medium text-white">{floor.name}</span>
                    {!isLoggedIn && (
                      <span className="mt-1 text-[10px] text-amber-300">Login to access</span>
                    )}
                  </div>
                </Html>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

export function BuildingScene() {
  const isLoggedIn = useOfficeStore((state) => state.isLoggedIn);

  return (
    <div className="h-full w-full bg-[#0b1220]">
      <Canvas
        shadows
        camera={{ position: [40, 25, 40], fov: 30 }}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={["#0b1220"]} />
        <fog attach="fog" args={["#0b1220", 30, 120]} />
        <ambientLight intensity={0.6} />
        <OrbitControls 
          makeDefault 
          enabled={isLoggedIn}
          target={[0, 12, 0]}
          minPolarAngle={Math.PI / 6} 
          maxPolarAngle={Math.PI / 2.1} 
          minDistance={10} 
          maxDistance={100}
        />
        
        <directionalLight
          castShadow
          intensity={1.5}
          color="#fff4df"
          position={[20, 40, 20]}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        >
          <orthographicCamera attach="shadow-camera" args={[-30, 30, 30, -30, 0.1, 100]} />
        </directionalLight>

        {/* Ground */}
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial color="#1a2235" roughness={0.9} metalness={0.1} />
        </mesh>
        
        <gridHelper args={[100, 50, "#2a364f", "#141b2d"]} position={[0, 0.01, 0]} />

        <Suspense fallback={<Html center><div className="text-white">Loading Building...</div></Html>}>
          <group position={[0, 0, 0]}>
            <BuildingModel />
            {isLoggedIn ? <FloorHitboxes /> : null}
          </group>
        </Suspense>

      </Canvas>
    </div>
  );
}

// Preload the model
useGLTF.preload("/models/props/london_office_building.glb");
