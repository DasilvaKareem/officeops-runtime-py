"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useGLTF, OrbitControls, Stage, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three-stdlib";
import { useOfficeStore } from "@/src/store/useOfficeStore";
import { AgentRole, AgentState, coerceAgentModelPath } from "@/src/lib/officeSim";

const MODELS = [
  { id: "Casual2_Male", label: "Casual (Male)", path: "/models/characters/Casual2_Male.gltf" },
  { id: "Casual3_Female", label: "Casual (Female)", path: "/models/characters/Casual3_Female.gltf" },
  { id: "OldClassy_Male", label: "Classy (Male)", path: "/models/characters/OldClassy_Male.gltf" },
  { id: "OldClassy_Female", label: "Classy (Female)", path: "/models/characters/OldClassy_Female.gltf" },
];

const ROLES: { id: AgentRole; label: string; color: string }[] = [
  { id: "manager", label: "Manager", color: "#8b5cf6" },
  { id: "research", label: "Researcher", color: "#22c55e" },
  { id: "writer", label: "Writer", color: "#3b82f6" },
  { id: "finance", label: "Finance", color: "#ef4444" },
  { id: "qa", label: "QA", color: "#06b6d4" },
];

function makeUniqueAgentId(role: AgentRole, existingIds: Set<string>) {
  let id = `${role}_${Date.now().toString(36)}`;
  while (existingIds.has(id)) {
    id = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }
  return id;
}

function PreviewModel({ modelPath, skinTone, eyeColor, hairColor }: { modelPath: string; skinTone: string; eyeColor: string; hairColor: string }) {
  const gltf = useGLTF(modelPath) as GLTF;
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as THREE.Group, [gltf.scene]);
  const { ref, actions } = useAnimations(gltf.animations);

  useEffect(() => {
    if (actions && actions["Idle"]) {
      actions["Idle"].reset().fadeIn(0.2).play();
    }
  }, [actions, modelPath]);

  useEffect(() => {
    const skinToneColor = new THREE.Color(skinTone);
    const eyeToneColor = new THREE.Color(eyeColor || "#332211");
    const hairToneColor = new THREE.Color(hairColor || "#111111");

    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const applyTone = (material: THREE.Material) => {
          const named = material as THREE.Material & { name?: string; color?: THREE.Color };
          const matName = (named.name ?? "").toLowerCase();
          
          const clonedMat = material.clone() as THREE.Material & { color?: THREE.Color };
          
          if (matName.includes("skin")) {
            if (clonedMat.color) clonedMat.color.copy(skinToneColor);
          } else if (matName.includes("eye") || matName.includes("cornea") || matName.includes("iris") || matName.includes("pupil")) {
            if (clonedMat.color) clonedMat.color.copy(eyeToneColor);
          } else if (matName.includes("hair")) {
            if (clonedMat.color) clonedMat.color.copy(hairToneColor);
          }
          
          return clonedMat;
        };
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => applyTone(mat));
        } else if (mesh.material) {
          mesh.material = applyTone(mesh.material);
        }
      }
    });
  }, [cloned, skinTone, eyeColor, hairColor]);

  return <primitive object={cloned} ref={ref} />;
}

type HireAgentModalProps = {
  existingAgent?: AgentState | null;
  onClose: () => void;
};

export function HireAgentModal({ existingAgent = null, onClose }: HireAgentModalProps) {
  const { addAgent, updateAgent, baseAgents } = useOfficeStore();
  const isEditing = Boolean(existingAgent);

  const [name, setName] = useState(existingAgent?.label ?? "New Agent");
  const [role, setRole] = useState<AgentRole>(existingAgent?.role ?? "research");
  const [modelPath, setModelPath] = useState(coerceAgentModelPath(existingAgent?.modelPath ?? MODELS[0].path));
  const [skinTone, setSkinTone] = useState(existingAgent?.skinTone ?? "#F1D3B3");
  const [eyeColor, setEyeColor] = useState(existingAgent?.eyeColor ?? "#332211");
  const [hairColor, setHairColor] = useState(existingAgent?.hairColor ?? "#111111");

  const skinTones = ["#F1D3B3", "#E0AC69", "#8D5524", "#C68642", "#FFDBAC"];
  const eyeColors = ["#332211", "#223344", "#445533", "#555555", "#111111"];
  const hairColors = ["#111111", "#4A3B32", "#A56B46", "#E5C8A8", "#8A0303", "#E0E0E0"];

  const handleHire = () => {
    const roleColor = ROLES.find(r => r.id === role)?.color || "#8b5cf6";

    if (existingAgent) {
      updateAgent(existingAgent.id, {
        role,
        label: name.trim() || existingAgent.label,
        color: roleColor,
        skinTone,
        eyeColor,
        hairColor,
        modelPath: coerceAgentModelPath(modelPath),
      });
      onClose();
      return;
    }

    const uniqueId = makeUniqueAgentId(role, new Set(baseAgents.map((agent) => agent.id)));
    const newAgent: AgentState = {
      id: uniqueId,
      role,
      label: name.trim() || "New Agent",
      color: roleColor,
      skinTone,
      eyeColor,
      hairColor,
      modelPath: coerceAgentModelPath(modelPath),
      status: "idle",
      balance: 0.0,
      currentTask: null,
      position: [0, 0.1, 0],
      idlePosition: [0, 0.1, 0],
      deskPosition: [(Math.random() - 0.5) * 4, 0.1, (Math.random() - 0.5) * 4],
    };

    addAgent(newAgent);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 pointer-events-auto">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/50 px-6 py-4">
          <h2 className="text-xl font-bold text-white">{isEditing ? "Edit Agent" : "Hire New Agent"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <div className="flex flex-col lg:flex-row gap-8">
            
            {/* Left: 3D Preview */}
            <div className="h-[400px] flex-1 rounded-xl border border-white/10 bg-slate-900/50">
              <Canvas shadows camera={{ position: [0, 1.5, 3], fov: 45 }}>
                <Stage intensity={0.5} environment="city" adjustCamera={false}>
                  <Suspense fallback={null}>
                    <PreviewModel modelPath={modelPath} skinTone={skinTone} eyeColor={eyeColor} hairColor={hairColor} />
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

            {/* Right: Configuration Form */}
            <div className="flex flex-col gap-5 w-full lg:w-80 overflow-y-auto max-h-[400px] pr-2">
              
              <div>
                <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Agent Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRole(r.id)}
                      className={`rounded-lg border py-2 text-xs font-semibold transition-all ${
                        role === r.id
                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                          : "border-white/10 bg-slate-900/80 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Model</label>
                <div className="grid grid-cols-2 gap-2">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setModelPath(m.path)}
                      className={`rounded-lg border px-2 py-2 text-[10px] font-semibold transition-all truncate ${
                        modelPath === m.path
                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                          : "border-white/10 bg-slate-900/80 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {m.label}
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
                      onClick={() => setSkinTone(tone)}
                      className={`h-6 w-6 rounded-full border-2 transition-all ${
                        skinTone === tone ? "border-white scale-110" : "border-transparent"
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
                      onClick={() => setHairColor(color)}
                      className={`h-6 w-6 rounded-full border-2 transition-all ${
                        hairColor === color ? "border-white scale-110" : "border-transparent"
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
                      onClick={() => setEyeColor(color)}
                      className={`h-6 w-6 rounded-full border-2 transition-all ${
                        eyeColor === color ? "border-white scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 bg-slate-900/50 px-6 py-4">
          <p className="text-xs text-slate-400">Total Agents on Floor: {baseAgents.length}</p>
          <button
            onClick={handleHire}
            className="rounded-lg bg-emerald-600 px-8 py-2.5 font-bold text-white transition hover:bg-emerald-500 flex items-center gap-2"
          >
            {isEditing ? "Save Agent" : "Deploy Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
