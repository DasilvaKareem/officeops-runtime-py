"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, useAnimations, useGLTF, OrbitControls, PivotControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three-stdlib";
import { useOfficeStore, type FurnitureItem } from "@/src/store/useOfficeStore";
import { coerceAgentModelPath, type AgentState } from "@/src/lib/officeSim";
import { AgentInteractionModal } from "@/src/components/office/AgentInteractionModal";

type Vec3 = [number, number, number];

function resolveDeskCollision(position: THREE.Vector3, furniture: FurnitureItem[]) {
  const colliders = furniture
    .filter(f => f.type === "desk" || f.type === "deskAlt")
    .map(f => ({
      minX: f.position[0] - 0.9 * f.scale / 0.58,
      maxX: f.position[0] + 0.9 * f.scale / 0.58,
      minZ: f.position[2] - 0.62 * f.scale / 0.58,
      maxZ: f.position[2] + 0.62 * f.scale / 0.58,
    }));

  for (const box of colliders) {
    if (
      position.x > box.minX &&
      position.x < box.maxX &&
      position.z > box.minZ &&
      position.z < box.maxZ
    ) {
      const pushLeft = Math.abs(position.x - box.minX);
      const pushRight = Math.abs(box.maxX - position.x);
      const pushTop = Math.abs(position.z - box.minZ);
      const pushBottom = Math.abs(box.maxZ - position.z);
      const minPush = Math.min(pushLeft, pushRight, pushTop, pushBottom);
      const pad = 0.06;

      if (minPush === pushLeft) position.x = box.minX - pad;
      else if (minPush === pushRight) position.x = box.maxX + pad;
      else if (minPush === pushTop) position.z = box.minZ - pad;
      else position.z = box.maxZ + pad;
    }
  }
}

function DeskFallback({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.08, 1.1]} />
        <meshStandardMaterial color="#7a4a29" roughness={0.6} />
      </mesh>
      {[[-0.75, 0.18, -0.45], [0.75, 0.18, -0.45], [-0.75, 0.18, 0.45], [0.75, 0.18, 0.45]].map((leg, idx) => (
        <mesh key={idx} position={leg as Vec3} castShadow>
          <boxGeometry args={[0.07, 0.34, 0.07]} />
          <meshStandardMaterial color="#603a20" roughness={0.7} />
        </mesh>
      ))}

      <mesh position={[0, 0.22, 0.94]} castShadow>
        <boxGeometry args={[0.6, 0.06, 0.6]} />
        <meshStandardMaterial color="#2c3544" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.48, 1.16]} castShadow>
        <boxGeometry args={[0.6, 0.46, 0.08]} />
        <meshStandardMaterial color="#243042" roughness={0.72} />
      </mesh>
      {[[-0.23, 0.1, 0.72], [0.23, 0.1, 0.72], [-0.23, 0.1, 1.16], [0.23, 0.1, 1.16]].map((leg, idx) => (
        <mesh key={`chair-leg-${idx}`} position={leg as Vec3} castShadow>
          <boxGeometry args={[0.05, 0.2, 0.05]} />
          <meshStandardMaterial color="#1f2633" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

const PROP_MODELS = {
  desk: "/models/props/60s_candidates/desk.glb",
  deskAlt: "/models/props/60s_candidates/desk_alt.glb",
  chair: "/models/props/60s_candidates/chair.glb",
  mug: "/models/props/60s_candidates/mug.glb",
  plant: "/models/props/60s_candidates/desk_plant.glb",
  coffeeHeater: "/models/props/60s_candidates/coffee_heater.glb",
  waterCooler: "/models/props/60s_candidates/water_cooler.glb",
} as const;

const DEFAULT_CEO_MODEL = "/models/characters/Suit_Male.gltf";
const DEFAULT_AGENT_MODEL = "/models/characters/Casual2_Male.gltf";
const DEFAULT_PROP_MODEL = PROP_MODELS.desk;
const OFFICE_SCALE = 3;
const OFFICE_WIDTH = 16 * OFFICE_SCALE;
const OFFICE_DEPTH = 12 * OFFICE_SCALE;
const OFFICE_HALF_WIDTH = OFFICE_WIDTH / 2;
const OFFICE_HALF_DEPTH = OFFICE_DEPTH / 2;
const OFFICE_EDGE_PADDING = 0.5;
const ELEVATOR_Z = -5.2 * OFFICE_SCALE;
const LOBBY_Z = -7;
const WING_ENTRY_X = OFFICE_WIDTH * 0.3;
const WING_ENTRY_Z = LOBBY_Z + 0.9;
const WING_INTERACT_RADIUS = 1.8;
const WING_DEST_Z = LOBBY_Z + 7.0;
const WING_EXIT_Z = WING_DEST_Z - 1.8;
const LOBBY_RETURN_Z = LOBBY_Z + 0.2;

function coerceModelPath(modelPath: unknown, fallbackModel: string) {
  return typeof modelPath === "string" && modelPath.trim().length > 0 ? modelPath : fallbackModel;
}

function getPropModelPath(type: unknown) {
  if (typeof type === "string" && type in PROP_MODELS) {
    return PROP_MODELS[type as keyof typeof PROP_MODELS];
  }
  return DEFAULT_PROP_MODEL;
}

function OfficeProp({
  item,
  editMode,
  onUpdate,
}: {
  item: FurnitureItem;
  editMode: boolean;
  onUpdate: (updates: Partial<FurnitureItem>) => void;
}) {
  const modelPath = getPropModelPath(item.type);
  const gltf = useGLTF(modelPath) as GLTF;
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as THREE.Group, [gltf.scene]);
  
  const [selected, setSelected] = useState(false);
  const [dragKey, setDragKey] = useState(0);
  const innerRef = useRef<THREE.Group>(null!);

  const recenter = item.type === "waterCooler";
  const ground = item.type === "waterCooler";

  const modelOffset = useMemo<Vec3>(() => {
    if (!(recenter || ground)) return [0, 0, 0];
    const box = new THREE.Box3().setFromObject(cloned);
    const center = new THREE.Vector3();
    box.getCenter(center);
    return [
      recenter ? -center.x : 0,
      ground ? -box.min.y : 0,
      recenter ? -center.z : 0,
    ];
  }, [cloned, recenter, ground]);

  useEffect(() => {
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [cloned]);

  const scaleArray: Vec3 = [item.scale, item.scale, item.scale];
  const selectedVisible = editMode && selected;

  return (
    <group 
      position={item.position} 
      rotation={item.rotation} 
      scale={scaleArray}
      onClick={(e) => {
        if (editMode) {
          e.stopPropagation();
          setSelected(!selected);
        }
      }}
    >
      <PivotControls
        key={dragKey}
        visible={selectedVisible}
        activeAxes={[true, true, true]}
        depthTest={false}
        scale={1}
        anchor={[0, 0, 0]}
        disableRotations={false}
        onDragEnd={() => {
          if (!innerRef.current) return;
          
          const pos = innerRef.current.position;
          const rot = innerRef.current.rotation;
          const sc = innerRef.current.scale;
          
          onUpdate({
            position: [
              item.position[0] + pos.x,
              item.position[1] + pos.y,
              item.position[2] + pos.z,
            ],
            rotation: [
              item.rotation[0] + rot.x,
              item.rotation[1] + rot.y,
              item.rotation[2] + rot.z,
            ],
            scale: item.scale * sc.x, // Assuming uniform scaling
          });
          
          // Force PivotControls to remount so it drops its internal offset
          setDragKey((k) => k + 1);
        }}
      >
        <group ref={innerRef}>
          <group position={modelOffset}>
            <primitive object={cloned} />
          </group>
        </group>
      </PivotControls>
    </group>
  );
}

function Elevator() {
  return (
    <group position={[0, 0, ELEVATOR_Z]}>
      {/* Frame */}
      <mesh position={[0, 1.35, 0]}>
        <boxGeometry args={[2.2, 2.7, 0.1]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Left Door */}
      <mesh position={[-0.52, 1.35, 0.06]}>
        <boxGeometry args={[1.0, 2.5, 0.05]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Right Door */}
      <mesh position={[0.52, 1.35, 0.06]}>
        <boxGeometry args={[1.0, 2.5, 0.05]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Indicator Light */}
      <mesh position={[0, 2.75, 0.06]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

function ElevatorLobby() {
  const lobbyWidth = OFFICE_WIDTH * 0.7;
  const lobbyDepth = 8;
  const elevatorHallWidth = 10;
  const elevatorHallDepth = 5;
  const connectorWidth = 5;
  const connectorDepth = Math.abs(ELEVATOR_Z - LOBBY_Z) - 2.4;
  const wingWidth = 7;
  const wingDepth = 10;
  const wingOffsetX = OFFICE_WIDTH * 0.3;
  const wingOffsetZ = WING_DEST_Z - 1.8;
  const connectorMidZ = (ELEVATOR_Z + LOBBY_Z) / 2;

  return (
    <group>
      {/* Elevator hall floor (separate rear zone) */}
      <mesh position={[0, 0.018, ELEVATOR_Z + 0.9]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[elevatorHallWidth, elevatorHallDepth]} />
        <meshStandardMaterial color="#835f43" roughness={0.86} metalness={0.03} />
      </mesh>

      {/* Main lobby floor (separate from elevator hall) */}
      <mesh position={[0, 0.015, LOBBY_Z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[lobbyWidth, lobbyDepth]} />
        <meshStandardMaterial color="#9c7451" roughness={0.82} metalness={0.03} />
      </mesh>

      {/* Connector corridor between lobby and elevator hall */}
      <mesh position={[0, 0.016, connectorMidZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[connectorWidth, connectorDepth]} />
        <meshStandardMaterial color="#8e6849" roughness={0.84} metalness={0.02} />
      </mesh>

      {/* Left and right wing corridor floor zones */}
      <mesh position={[-wingOffsetX, 0.02, wingOffsetZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[wingWidth, wingDepth]} />
        <meshStandardMaterial color="#8f6848" roughness={0.85} metalness={0.02} />
      </mesh>
      <mesh position={[wingOffsetX, 0.02, wingOffsetZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[wingWidth, wingDepth]} />
        <meshStandardMaterial color="#8f6848" roughness={0.85} metalness={0.02} />
      </mesh>

      {/* Wing exit markers (return to elevator lobby) */}
      <mesh position={[-WING_ENTRY_X, 0.03, WING_EXIT_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.55, 32]} />
        <meshStandardMaterial color="#22d3ee" emissive="#155e75" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[WING_ENTRY_X, 0.03, WING_EXIT_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.55, 32]} />
        <meshStandardMaterial color="#22d3ee" emissive="#155e75" emissiveIntensity={0.35} />
      </mesh>

      {/* Wing portal frames */}
      <group position={[-wingOffsetX, 0, WING_ENTRY_Z]}>
        <mesh position={[0, 1.5, 0]}>
          <boxGeometry args={[4.8, 0.24, 0.2]} />
          <meshStandardMaterial color="#2a3342" metalness={0.35} roughness={0.45} />
        </mesh>
        <mesh position={[-2.25, 0.76, 0]}>
          <boxGeometry args={[0.24, 1.5, 0.2]} />
          <meshStandardMaterial color="#2a3342" metalness={0.35} roughness={0.45} />
        </mesh>
        <mesh position={[2.25, 0.76, 0]}>
          <boxGeometry args={[0.24, 1.5, 0.2]} />
          <meshStandardMaterial color="#2a3342" metalness={0.35} roughness={0.45} />
        </mesh>
      </group>
      <group position={[wingOffsetX, 0, WING_ENTRY_Z]}>
        <mesh position={[0, 1.5, 0]}>
          <boxGeometry args={[4.8, 0.24, 0.2]} />
          <meshStandardMaterial color="#2a3342" metalness={0.35} roughness={0.45} />
        </mesh>
        <mesh position={[-2.25, 0.76, 0]}>
          <boxGeometry args={[0.24, 1.5, 0.2]} />
          <meshStandardMaterial color="#2a3342" metalness={0.35} roughness={0.45} />
        </mesh>
        <mesh position={[2.25, 0.76, 0]}>
          <boxGeometry args={[0.24, 1.5, 0.2]} />
          <meshStandardMaterial color="#2a3342" metalness={0.35} roughness={0.45} />
        </mesh>
      </group>

      {/* Lobby center accent */}
      <mesh position={[0, 0.03, LOBBY_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[lobbyWidth * 0.58, 0.34]} />
        <meshStandardMaterial color="#4b647e" emissive="#1f2d3d" emissiveIntensity={0.2} />
      </mesh>

      <Elevator />
    </group>
  );
}

function AgentCube({
  id,
  label,
  color,
  status,
  target,
  task,
}: {
  id: string;
  label: string;
  color: string;
  status: string;
  target?: Vec3;
  task: string | null;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const targetV = useMemo(() => new THREE.Vector3(), []);
  const furniture = useOfficeStore((s) => s.furniture);
  const safeTarget: Vec3 = useMemo(() => target ?? [0, 0.5, 0], [target]);

  useEffect(() => {
    if (ref.current) {
      ref.current.position.set(safeTarget[0], 0.5, safeTarget[2]);
    }
  }, [safeTarget]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    targetV.set(safeTarget[0], safeTarget[1], safeTarget[2]);
    const speed = status === "moving" || status === "returning" ? 2.2 : 3.2;
    ref.current.position.lerp(targetV, Math.min(1, delta * speed));
    if (status === "moving" || status === "returning") resolveDeskCollision(ref.current.position, furniture);
    ref.current.position.y = 0.5 + Math.sin(performance.now() * 0.003 + id.length) * 0.02;
  });

  const liveColor =
    status === "working" ? "#facc15" : status === "standing" ? "#fde047" : status === "moving" || status === "returning" ? "#86efac" : status === "celebrating" ? "#c084fc" : status === "failed" ? "#ef4444" : color;

  return (
    <group>
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[0.56, 0.56, 0.56]} />
        <meshStandardMaterial color={liveColor} roughness={0.4} metalness={0.1} />
        <Html position={[0, 0.56, 0]} center style={{ pointerEvents: "none" }}>
          <div className="rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[10px] text-white whitespace-nowrap">
            <div className="font-medium">{label}</div>
            <div className="text-[9px] text-emerald-300">{task ?? status}</div>
          </div>
        </Html>
      </mesh>
    </group>
  );
}

function useKeyboard() {
  const keys = useRef({ forward: false, backward: false, left: false, right: false, jump: false, interact: false, quit: false, talk: false });
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      if (['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'KeyR'].includes(e.code)) {
        e.preventDefault(); // prevent scrolling/panning
      }
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.forward = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.backward = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.right = true;
      if (e.code === 'Space') keys.current.jump = true;
      if (e.code === 'KeyE') keys.current.interact = true;
      if (e.code === 'KeyQ') keys.current.quit = true;
      if (e.code === 'KeyR') keys.current.talk = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.forward = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.backward = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.right = false;
      if (e.code === 'Space') keys.current.jump = false;
      if (e.code === 'KeyE') keys.current.interact = false;
      if (e.code === 'KeyQ') keys.current.quit = false;
      if (e.code === 'KeyR') keys.current.talk = false;
    };
    
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  return keys;
}

function AnimatedAgent({
  id,
  label,
  color,
  skinTone,
  eyeColor,
  hairColor,
  status,
  target,
  task,
  modelPath,
}: {
  id: string;
  label: string;
  color: string;
  skinTone: string;
  eyeColor: string;
  hairColor: string;
  status: string;
  target?: Vec3;
  task: string | null;
  modelPath?: string;
}) {
  const group = useRef<THREE.Group>(null!);
  const targetV = useMemo(() => new THREE.Vector3(), []);
  const { furniture, interactingAgentId } = useOfficeStore();
  const safeModelPath = coerceAgentModelPath(coerceModelPath(modelPath, DEFAULT_AGENT_MODEL));
  const gltf = useGLTF(safeModelPath) as GLTF;
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as THREE.Group, [gltf.scene]);
  const { ref: animRef, actions } = useAnimations(gltf.animations);

  const targetAngle = useRef(0);
  const safeTarget: Vec3 = useMemo(() => target ?? [0, 0.1, 0], [target]);

  useEffect(() => {
    if (group.current) {
      group.current.position.set(safeTarget[0], 0.1, safeTarget[2]);
    }
  }, [safeTarget]);

  useEffect(() => {
    const skinToneColor = new THREE.Color(skinTone);
    const eyeToneColor = new THREE.Color(eyeColor || "#332211");
    const hairToneColor = new THREE.Color(hairColor || "#111111");
    
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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

  useEffect(() => {
    const preferred =
      status === "working"
        ? ["SitDown", "Idle"]
        : status === "standing"
          ? ["StandUp", "Idle"]
          : status === "moving"
            ? ["Run_Carry", "Walk_Carry", "Run"]
            : status === "returning"
              ? ["Run", "Walk"]
              : status === "celebrating"
                ? ["Victory", "Jump", "Idle"]
                : status === "failed"
                  ? ["Defeat", "Idle"]
                  : ["Idle"];
    const all = Object.keys(actions);
    const nextName = preferred.find((name) => actions[name]) ?? all[0];
    if (!nextName) return;
    const next = actions[nextName];
    if (!next) return;
    next.reset().fadeIn(0.18).play();
    return () => {
      next.fadeOut(0.18);
    };
  }, [actions, status]);

  useFrame((state, delta) => {
    if (!group.current) return;
    targetV.set(safeTarget[0], safeTarget[1], safeTarget[2]);
    const currentPos = group.current.position;
    const distance = currentPos.distanceTo(targetV);

    if (distance > 0.1) {
      const speed = status === "moving" || status === "returning" ? 2.8 : 3.8;
      currentPos.lerp(targetV, Math.min(1, delta * speed));
      if (status === "moving" || status === "returning") resolveDeskCollision(currentPos, furniture);
      targetAngle.current = Math.atan2(targetV.x - currentPos.x, targetV.z - currentPos.z);
    } else {
      // If we are the interacting agent, face the camera/CEO
      if (interactingAgentId === id) {
        const cameraPos = state.camera.position;
        targetAngle.current = Math.atan2(cameraPos.x - currentPos.x, cameraPos.z - currentPos.z);
      } else {
        // At target: face forward (+Z) if at desk, otherwise right (+X)
        if (status === "working" || status === "standing" || status === "celebrating" || status === "idle") {
          targetAngle.current = 0;
        } else {
          targetAngle.current = Math.PI / 2;
        }
      }
    }

    let diff = targetAngle.current - group.current.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    group.current.rotation.y += diff * Math.min(1, delta * 8);

    currentPos.y = 0.1;
  });

  const liveColor =
    status === "working" ? "#facc15" : status === "standing" ? "#fde047" : status === "moving" || status === "returning" ? "#86efac" : status === "celebrating" ? "#c084fc" : status === "failed" ? "#ef4444" : color;

  return (
    <group ref={group}>
      <group rotation={[0, Math.PI, 0]} scale={[0.62, 0.62, 0.62]}>
        <primitive object={cloned} ref={animRef} />
      </group>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.28, 24]} />
        <meshStandardMaterial color={liveColor} transparent opacity={0.5} />
      </mesh>
      <Html position={[0, 1.55, 0]} center style={{ pointerEvents: "none" }}>
        <div className="rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[10px] text-white whitespace-nowrap">
          <div className="font-medium">{label}</div>
          <div className="text-[9px] text-emerald-300">{task ?? status}</div>
        </div>
      </Html>
    </group>
  );
}

function ControlledCEO({
  label,
  color,
  skinTone,
  eyeColor,
  hairColor,
  initialPosition,
  modelPath,
}: {
  label: string;
  color: string;
  skinTone: string;
  eyeColor: string;
  hairColor: string;
  initialPosition: Vec3;
  modelPath?: string;
}) {
  const MODEL_FORWARD_OFFSET = Math.PI;
  const group = useRef<THREE.Group>(null!);
  const [animStatus, setAnimStatus] = useState("idle");
  const [nearbyAgent, setNearbyAgent] = useState<AgentState | null>(null);
  const [isNearElevator, setIsNearElevator] = useState(false);
  const [isNearLeftWing, setIsNearLeftWing] = useState(false);
  const [isNearRightWing, setIsNearRightWing] = useState(false);
  const [isNearWingExit, setIsNearWingExit] = useState(false);

  // Physics state
  const velocityY = useRef(0);
  const isGrounded = useRef(true);

  const { 
    furniture, 
    agents, 
    interactingAgentId, 
    setInteractingAgentId, 
    selectedFloor, 
    showElevatorModal, 
    setShowElevatorModal,
    isControlling,
    setIsControlling,
    editMode,
    isRecording,
    setIsRecording
  } = useOfficeStore();
  const keys = useKeyboard();
  const safeModelPath = coerceModelPath(modelPath, DEFAULT_CEO_MODEL);
  const gltf = useGLTF(safeModelPath) as GLTF;
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene) as THREE.Group, [gltf.scene]);
  const { ref: animRef, actions } = useAnimations(gltf.animations);

  const prevFloorRef = useRef<number | null>(null);

  // Only reset position when the floor ACTUALLY changes
  useEffect(() => {
    if (group.current && prevFloorRef.current !== selectedFloor) {
      group.current.position.set(initialPosition[0], initialPosition[1], initialPosition[2]);
      prevFloorRef.current = selectedFloor;
    }
  }, [selectedFloor, initialPosition]);

  useEffect(() => {
    const skinToneColor = new THREE.Color(skinTone);
    const eyeToneColor = new THREE.Color(eyeColor || "#332211");
    const hairToneColor = new THREE.Color(hairColor || "#111111");
    
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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

  useEffect(() => {
    let preferred = ["Idle"];
    if (animStatus === "jumping") preferred = ["Jump", "Victory", "Run"];
    else if (animStatus === "moving") preferred = ["Run", "Walk", "Run_Carry"];
    
    const all = Object.keys(actions);
    const nextName = preferred.find((name) => actions[name]) ?? all[0];
    if (!nextName) return;
    
    const next = actions[nextName];
    if (!next) return;
    
    // Jump animation usually doesn't loop well if we hold it, 
    // but we can let it play once or just loop depending on the rig.
    next.reset().fadeIn(0.2).play();
    return () => {
      next.fadeOut(0.2);
    };
  }, [actions, animStatus]);

  useFrame((state, delta) => {
    if (!group.current) return;

    let isMoving = false;
    
    // Movement logic - disabled during interaction
    if (isControlling && !interactingAgentId && !showElevatorModal) {
      const camera = state.camera;
      
      // Get camera directions
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      
      // Flatten to XZ plane
      forward.y = 0;
      right.y = 0;
      forward.normalize();
      right.normalize();

      const moveDir = new THREE.Vector3(0, 0, 0);
      if (keys.current.forward) moveDir.add(forward);
      if (keys.current.backward) moveDir.sub(forward);
      if (keys.current.left) moveDir.sub(right);
      if (keys.current.right) moveDir.add(right);

      if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        const speed = 4.2;
        group.current.position.addScaledVector(moveDir, speed * delta);
        
        // Boundaries (Office is scaled up 3x from 16x12)
        group.current.position.x = Math.max(-(OFFICE_HALF_WIDTH - OFFICE_EDGE_PADDING), Math.min(OFFICE_HALF_WIDTH - OFFICE_EDGE_PADDING, group.current.position.x));
        group.current.position.z = Math.max(-(OFFICE_HALF_DEPTH - OFFICE_EDGE_PADDING), Math.min(OFFICE_HALF_DEPTH - OFFICE_EDGE_PADDING, group.current.position.z));
        
        resolveDeskCollision(group.current.position, furniture);
        
        const targetAngle = Math.atan2(moveDir.x, moveDir.z) + MODEL_FORWARD_OFFSET;
        let diff = targetAngle - group.current.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        group.current.rotation.y += diff * Math.min(1, delta * 12);
        
        isMoving = true;
      }
    }

    // Interaction facing logic
    if (interactingAgentId && nearbyAgent) {
      const agentPos = new THREE.Vector3(nearbyAgent.position[0], 0.1, nearbyAgent.position[2]);
      const ceoPos = group.current.position;
      
      // CEO faces Agent
      const targetAngle = Math.atan2(agentPos.x - ceoPos.x, agentPos.z - ceoPos.z) + MODEL_FORWARD_OFFSET;
      let diff = targetAngle - group.current.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      group.current.rotation.y += diff * Math.min(1, delta * 10);
    }

    // Proximity Detection
    if (isControlling) {
      let closest: AgentState | null = null;
      let minDist = 2.0; // Interaction radius

      agents.forEach(agent => {
        const agentPos = new THREE.Vector3(agent.position[0], agent.position[1], agent.position[2]);
        const dist = group.current.position.distanceTo(agentPos);
        if (dist < minDist) {
          minDist = dist;
          closest = agent;
        }
      });
      
      if (closest !== nearbyAgent) setNearbyAgent(closest);

      // Elevator proximity
      const elevatorPos = new THREE.Vector3(0, 0, ELEVATOR_Z);
      const distToElevator = group.current.position.distanceTo(elevatorPos);
      const nearElevator = distToElevator < 2.0;
      if (nearElevator !== isNearElevator) setIsNearElevator(nearElevator);

      // Wing entrance proximity
      const leftWingEntry = new THREE.Vector3(-WING_ENTRY_X, 0, WING_ENTRY_Z);
      const rightWingEntry = new THREE.Vector3(WING_ENTRY_X, 0, WING_ENTRY_Z);
      const nearLeftWing = group.current.position.distanceTo(leftWingEntry) < WING_INTERACT_RADIUS;
      const nearRightWing = group.current.position.distanceTo(rightWingEntry) < WING_INTERACT_RADIUS;
      const leftWingExit = new THREE.Vector3(-WING_ENTRY_X, 0, WING_EXIT_Z);
      const rightWingExit = new THREE.Vector3(WING_ENTRY_X, 0, WING_EXIT_Z);
      const nearWingExit =
        group.current.position.distanceTo(leftWingExit) < WING_INTERACT_RADIUS ||
        group.current.position.distanceTo(rightWingExit) < WING_INTERACT_RADIUS;
      if (nearLeftWing !== isNearLeftWing) setIsNearLeftWing(nearLeftWing);
      if (nearRightWing !== isNearRightWing) setIsNearRightWing(nearRightWing);
      if (nearWingExit !== isNearWingExit) setIsNearWingExit(nearWingExit);

      // Handle Interaction Input
      if (keys.current.interact) {
        if (nearWingExit) {
          group.current.position.set(0, 0.1, LOBBY_RETURN_Z);
          keys.current.interact = false;
        } else if (nearLeftWing) {
          group.current.position.set(-WING_ENTRY_X, 0.1, WING_DEST_Z);
          keys.current.interact = false;
        } else if (nearRightWing) {
          group.current.position.set(WING_ENTRY_X, 0.1, WING_DEST_Z);
          keys.current.interact = false;
        } else if (nearbyAgent && !interactingAgentId) {
          setInteractingAgentId(nearbyAgent.id);
          keys.current.interact = false;
        } else if (isNearElevator && !showElevatorModal) {
          setShowElevatorModal(true);
          keys.current.interact = false;
        }
      }

      // Handle Push to Talk
      if (interactingAgentId && keys.current.talk) {
        if (!isRecording) setIsRecording(true);
      } else {
        if (isRecording) setIsRecording(false);
      }
    }

    // Camera Logic
    const controls = state.controls as any;
    if (controls && controls.target) {
      if (showElevatorModal) {
        // Elevator cinematic angle
        const elevatorPos = new THREE.Vector3(0, 1.35, ELEVATOR_Z);
        controls.target.lerp(elevatorPos, delta * 4);
        const targetCamPos = new THREE.Vector3(2, 2.5, ELEVATOR_Z + 2.7);
        state.camera.position.lerp(targetCamPos, delta * 3);
      } else if (isControlling) {
        // Standard Follow Camera - keep this stable even during chat.
        const targetPos = new THREE.Vector3(group.current.position.x, 0.8, group.current.position.z);
        controls.target.lerp(targetPos, delta * 5);
        controls.update();
      }
    }

    // Jump Logic
    if (isControlling && !interactingAgentId && !showElevatorModal) {
      if (keys.current.jump && isGrounded.current) {
        velocityY.current = 5.0; // Initial jump velocity
        isGrounded.current = false;
      }
    }
    
    // Apply gravity
    if (!isGrounded.current) {
      velocityY.current -= 15.0 * delta; // Gravity
      group.current.position.y += velocityY.current * delta;
      
      if (group.current.position.y <= 0.1) {
        group.current.position.y = 0.1;
        isGrounded.current = true;
        velocityY.current = 0;
      }
    }

    // Determine Animation Status
    let newStatus = "idle";
    if (!isGrounded.current) newStatus = "jumping";
    else if (isMoving) newStatus = "moving";

    if (newStatus !== animStatus) setAnimStatus(newStatus);
  });

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "q" || e.key === "Q") {
        if (interactingAgentId || showElevatorModal) {
          setInteractingAgentId(null);
          setShowElevatorModal(false);
        } else {
          setIsControlling(false);
        }
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [setIsControlling, setInteractingAgentId, setShowElevatorModal, interactingAgentId, showElevatorModal]);

  return (
    <group 
      ref={group} 
      onClick={(e) => {
        if (editMode) return;
        e.stopPropagation();
        setIsControlling(true);
      }}
    >
      <group rotation={[0, Math.PI, 0]} scale={[0.62, 0.62, 0.62]}>
        <primitive object={cloned} ref={animRef} />
      </group>
      
      {/* Selection Ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[isControlling ? 0.4 : 0.28, 32]} />
        <meshStandardMaterial 
          color={isControlling ? "#10b981" : color} 
          transparent 
          opacity={isControlling ? 0.8 : 0.5} 
          wireframe={isControlling}
        />
      </mesh>
      
      <Html position={[0, 1.55, 0]} center style={{ pointerEvents: "none" }}>
        <div className="flex flex-col items-center gap-1.5">
          {isControlling && nearbyAgent && !interactingAgentId && (
             <div className="rounded-md border border-emerald-500 bg-emerald-500/20 px-2 py-1 text-[10px] text-white font-bold animate-bounce shadow-lg backdrop-blur-md">
               Press E to Interact with {nearbyAgent.label}
             </div>
          )}
          {isControlling && isNearWingExit && !interactingAgentId && !showElevatorModal && (
             <div className="rounded-md border border-cyan-500 bg-cyan-500/20 px-2 py-1 text-[10px] text-white font-bold animate-bounce shadow-lg backdrop-blur-md">
               Press E to Exit to Elevator Lobby
             </div>
          )}
          {isControlling && isNearLeftWing && !interactingAgentId && !showElevatorModal && (
             <div className="rounded-md border border-sky-500 bg-sky-500/20 px-2 py-1 text-[10px] text-white font-bold animate-bounce shadow-lg backdrop-blur-md">
               Press E to Enter Left Wing
             </div>
          )}
          {isControlling && isNearRightWing && !interactingAgentId && !showElevatorModal && (
             <div className="rounded-md border border-cyan-500 bg-cyan-500/20 px-2 py-1 text-[10px] text-white font-bold animate-bounce shadow-lg backdrop-blur-md">
               Press E to Enter Right Wing
             </div>
          )}
          {isControlling && isNearElevator && !nearbyAgent && !showElevatorModal && (
             <div className="rounded-md border border-amber-500 bg-amber-500/20 px-2 py-1 text-[10px] text-white font-bold animate-bounce shadow-lg backdrop-blur-md">
               Press E to Enter Elevator
             </div>
          )}
          <div className="rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[10px] text-white whitespace-nowrap">
            <div className="font-medium">{label}</div>
            <div className="text-[9px] text-emerald-300">
              {isControlling ? "WASD to move (Q to stop)" : "Click to control"}
            </div>
          </div>
        </div>
      </Html>
    </group>
  );
}

const CHARACTER_MODELS = [
  "/models/characters/Suit_Female.gltf",
  "/models/characters/Suit_Male.gltf",
  "/models/characters/OldClassy_Male.gltf",
  "/models/characters/OldClassy_Female.gltf",
  "/models/characters/Casual2_Male.gltf",
  "/models/characters/Casual3_Female.gltf",
];

for (const model of CHARACTER_MODELS) useGLTF.preload(model);

for (const model of Object.values(PROP_MODELS)) useGLTF.preload(model);

export function OfficeScene() {
  const { agents, furniture, editMode, updateFurnitureItem, isLoggedIn, userProfile, interactingAgentId } = useOfficeStore();

  const ceoModelPath = useMemo(() => {
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
  }, [userProfile.outfit, userProfile.gender]);

  return (
    <div className="h-full w-full rounded-lg border border-white/10 bg-slate-950/90 shadow-[0_0_50px_rgba(16,58,133,0.25)]">
      <Canvas
        shadows
        camera={{ position: [0, 9.2 * OFFICE_SCALE, 11 * OFFICE_SCALE], fov: 35 }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 0, 0);
        }}
      >
        <color attach="background" args={["#0b1220"]} />
        <fog attach="fog" args={["#0b1220", 10 * OFFICE_SCALE, 28 * OFFICE_SCALE]} />
        <ambientLight intensity={0.55} />
        <OrbitControls 
          makeDefault 
          minPolarAngle={Math.PI / 6} 
          maxPolarAngle={Math.PI / 2.2} 
          minDistance={5} 
          maxDistance={18 * OFFICE_SCALE}
          enabled={!editMode}
        />
        <directionalLight
          castShadow
          intensity={1.2}
          color="#fff4df"
          position={[5, 10, 4]}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />

        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[OFFICE_WIDTH, OFFICE_DEPTH]} />
          <meshStandardMaterial color="#b68458" roughness={0.88} metalness={0.02} />
        </mesh>

        <gridHelper args={[OFFICE_WIDTH, OFFICE_WIDTH, "#80593a", "#8f6544"]} position={[0, 0.01, 0]} />

        <ElevatorLobby />

        {furniture.map((item) => (
          <Suspense key={item.id} fallback={item.type === "desk" || item.type === "deskAlt" ? <DeskFallback position={item.position} /> : null}>
            <OfficeProp 
              item={item} 
              editMode={editMode} 
              onUpdate={(updates) => updateFurnitureItem(item.id, updates)}
            />
          </Suspense>
        ))}

        {agents.map((agent, index) => {
          const position: Vec3 = agent.position ?? [index * 1.2 - 2, 0.1, 1];

          return (
            <Suspense
              key={agent.id}
              fallback={
                <AgentCube
                  id={agent.id}
                  label={agent.label}
                  color={agent.color}
                  status={agent.status}
                  target={position}
                  task={agent.currentTask}
                />
              }
            >
              <AnimatedAgent
                id={agent.id}
                label={agent.label}
                color={agent.color}
                skinTone={agent.skinTone}
                eyeColor={agent.eyeColor}
                hairColor={agent.hairColor}
                status={agent.status}
                target={position}
                task={agent.currentTask}
                modelPath={agent.modelPath}
              />
            </Suspense>
          );
        })}

        {/* CEO Avatar */}
        {isLoggedIn && (
          <Suspense fallback={null}>
            <ControlledCEO
              label={`${userProfile.name || "CEO"}`}
              color="#fbbf24"
              skinTone={userProfile.skinTone}
              eyeColor={userProfile.eyeColor}
              hairColor={userProfile.hairColor}
              initialPosition={[0, 0.1, 4.5 * OFFICE_SCALE]}
              modelPath={ceoModelPath}
            />
          </Suspense>
        )}

        {/* Floating Interaction HUD */}
        {interactingAgentId && <AgentInteractionModal />}

        <mesh position={[0, 1.6, -5.4 * OFFICE_SCALE]}>
          <boxGeometry args={[6.8 * OFFICE_SCALE, 2.7, 0.2]} />
          <meshStandardMaterial color="#2f2f33" />
        </mesh>
      </Canvas>
    </div>
  );
}
