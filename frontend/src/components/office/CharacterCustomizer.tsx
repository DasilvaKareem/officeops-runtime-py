"use client";

import { Canvas } from "@react-three/fiber";
import { useGLTF, OrbitControls, Stage, useAnimations } from "@react-three/drei";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three-stdlib";
import { useOfficeStore } from "@/src/store/useOfficeStore";

function CustomizerModel() {
  const { userProfile } = useOfficeStore();
  const getModelPath = () => {
    if (userProfile.outfit === "casual") {
      return userProfile.gender === "male" 
        ? "/models/characters/Casual2_Male.gltf" 
        : "/models/characters/Casual3_Female.gltf";
    }
    if (userProfile.outfit === "classy") {
      return userProfile.gender === "male" 
        ? "/models/characters/OldClassy_Male.gltf" 
        : "/models/characters/OldClassy_Female.gltf";
    }
    return userProfile.gender === "male" 
      ? "/models/characters/Suit_Male.gltf" 
      : "/models/characters/Suit_Female.gltf";
  };
    
  const gltf = useGLTF(getModelPath()) as GLTF;
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as THREE.Group, [gltf.scene]);
  const { ref, actions } = useAnimations(gltf.animations);

  useEffect(() => {
    if (actions && actions["Idle"]) {
      actions["Idle"].reset().fadeIn(0.2).play();
    }
  }, [actions, userProfile.gender, userProfile.outfit]);

  useEffect(() => {
    const skinColor = new THREE.Color(userProfile.skinTone);
    const eyeColor = new THREE.Color(userProfile.eyeColor);
    const hairColor = new THREE.Color(userProfile.hairColor || "#111111");

    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const applyColors = (material: THREE.Material) => {
          const named = material as THREE.Material & { name?: string; color?: THREE.Color };
          const matName = (named.name ?? "").toLowerCase();
          
          const clonedMat = material.clone() as THREE.Material & { color?: THREE.Color };
          
          if (matName.includes("skin")) {
            if (clonedMat.color) clonedMat.color.copy(skinColor);
          } else if (matName.includes("eye") || matName.includes("cornea") || matName.includes("iris") || matName.includes("pupil")) {
            if (clonedMat.color) clonedMat.color.copy(eyeColor);
          } else if (matName.includes("hair")) {
            if (clonedMat.color) clonedMat.color.copy(hairColor);
          }
          
          return clonedMat;
        };

        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => applyColors(mat));
        } else if (mesh.material) {
          mesh.material = applyColors(mesh.material);
        }
      }
    });
  }, [cloned, userProfile.skinTone, userProfile.eyeColor, userProfile.hairColor]);

  return <primitive object={cloned} ref={ref} />;
}

export function CharacterCustomizer() {
  const { userProfile, setUserProfile } = useOfficeStore();

  const skinTones = ["#F1D3B3", "#E0AC69", "#8D5524", "#C68642", "#FFDBAC"];
  const eyeColors = ["#332211", "#223344", "#445533", "#555555", "#111111"];
  const hairColors = ["#111111", "#4A3B32", "#A56B46", "#E5C8A8", "#8A0303", "#E0E0E0"];

  return (
    <div className="flex h-full w-full flex-col lg:flex-row gap-6">
      <div className="h-[400px] flex-1 rounded-xl border border-white/10 bg-slate-900/50">
        <Canvas shadows camera={{ position: [0, 1.5, 3], fov: 45 }}>
          <Stage intensity={0.5} environment="city" adjustCamera={false}>
            <Suspense fallback={null}>
              <CustomizerModel />
            </Suspense>
          </Stage>
          <OrbitControls 
            enablePan={false} 
            minPolarAngle={Math.PI / 4} 
            maxPolarAngle={Math.PI / 1.5}
            minDistance={2}
            maxDistance={5}
            target={[0, 1, 0]}
          />
        </Canvas>
      </div>

      <div className="flex flex-col gap-5 w-full lg:w-72 overflow-y-auto pr-2">
        <div>
          <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Gender</label>
          <div className="flex gap-2">
            {(["male", "female"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setUserProfile({ gender: g })}
                className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition-all ${
                  userProfile.gender === g
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                    : "border-white/10 bg-slate-900/80 text-slate-400 hover:bg-slate-800"
                }`}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Style</label>
          <div className="flex gap-2">
            {(["suit", "casual", "classy"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setUserProfile({ outfit: o })}
                className={`flex-1 rounded-lg border py-2 text-[11px] font-semibold transition-all ${
                  userProfile.outfit === o
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                    : "border-white/10 bg-slate-900/80 text-slate-400 hover:bg-slate-800"
                }`}
              >
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Skin Tone</label>
          <div className="flex flex-wrap gap-2">
            {skinTones.map((tone) => (
              <button
                key={tone}
                onClick={() => setUserProfile({ skinTone: tone })}
                className={`h-8 w-8 rounded-full border-2 transition-all ${
                  userProfile.skinTone === tone ? "border-white scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: tone }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Hair Color</label>
          <div className="flex flex-wrap gap-2">
            {hairColors.map((color) => (
              <button
                key={color}
                onClick={() => setUserProfile({ hairColor: color })}
                className={`h-8 w-8 rounded-full border-2 transition-all ${
                  userProfile.hairColor === color ? "border-white scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Eye Color</label>
          <div className="flex flex-wrap gap-2">
            {eyeColors.map((color) => (
              <button
                key={color}
                onClick={() => setUserProfile({ eyeColor: color })}
                className={`h-8 w-8 rounded-full border-2 transition-all ${
                  userProfile.eyeColor === color ? "border-white scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

useGLTF.preload("/models/characters/Suit_Male.gltf");
useGLTF.preload("/models/characters/Suit_Female.gltf");
useGLTF.preload("/models/characters/Casual2_Male.gltf");
useGLTF.preload("/models/characters/Casual3_Female.gltf");
useGLTF.preload("/models/characters/OldClassy_Male.gltf");
useGLTF.preload("/models/characters/OldClassy_Female.gltf");
