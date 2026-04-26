"use client";

import { useEffect, useRef } from "react";
import { auth, db } from "@/src/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref, get, set } from "firebase/database";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildInitialAgents,
  coerceAgentModelPath,
  getAgentHomePosition,
  type AgentState,
} from "@/src/lib/officeSim";
import { useOfficeStore, initialFurniture, type UserProfile } from "@/src/store/useOfficeStore";
import { syncRuntimeAgentsForFloor } from "@/src/lib/companyRuntime";

function walletStorageKey(uid: string) {
  return `officeops_wallet_pk_${uid}`;
}

function ensureLocalWallet(uid: string): { privateKey: `0x${string}`; address: string } {
  const key = walletStorageKey(uid);
  const existing = localStorage.getItem(key);
  if (existing && existing.startsWith("0x")) {
    const account = privateKeyToAccount(existing as `0x${string}`);
    return { privateKey: existing as `0x${string}`, address: account.address };
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  localStorage.setItem(key, privateKey);
  return { privateKey, address: account.address };
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function normalizeAgents(rawAgents: unknown[]): AgentState[] {
  const fallbackAgents = buildInitialAgents();
  const fallbackById = new Map(fallbackAgents.map((agent) => [agent.id, agent]));

  const normalizedAgents = rawAgents
    .filter(Boolean)
    .map((entry, index) => {
      const candidate = entry as Partial<AgentState>;
      const fallbackByCandidateId = typeof candidate.id === "string" ? fallbackById.get(candidate.id) : undefined;
      const fallback = fallbackByCandidateId ?? fallbackAgents[index % fallbackAgents.length];

      const normalized: AgentState = {
        ...fallback,
        ...candidate,
        id: typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id : fallback.id,
        role: candidate.role ?? fallback.role,
        label: typeof candidate.label === "string" && candidate.label.trim().length > 0 ? candidate.label : fallback.label,
        color: typeof candidate.color === "string" && candidate.color.trim().length > 0 ? candidate.color : fallback.color,
        skinTone:
          typeof candidate.skinTone === "string" && candidate.skinTone.trim().length > 0
            ? candidate.skinTone
            : fallback.skinTone,
        eyeColor:
          typeof candidate.eyeColor === "string" && candidate.eyeColor.trim().length > 0
            ? candidate.eyeColor
            : fallback.eyeColor,
        hairColor:
          typeof candidate.hairColor === "string" && candidate.hairColor.trim().length > 0
            ? candidate.hairColor
            : fallback.hairColor,
        modelPath:
          coerceAgentModelPath(
            typeof candidate.modelPath === "string" && candidate.modelPath.trim().length > 0
              ? candidate.modelPath
              : fallback.modelPath
          ),
        status: candidate.status ?? fallback.status,
        balance: typeof candidate.balance === "number" && Number.isFinite(candidate.balance) ? candidate.balance : fallback.balance,
        currentTask: typeof candidate.currentTask === "string" ? candidate.currentTask : null,
        position: isVec3(candidate.position) ? candidate.position : fallback.position,
        idlePosition: isVec3(candidate.idlePosition) ? candidate.idlePosition : fallback.idlePosition,
        deskPosition: isVec3(candidate.deskPosition) ? candidate.deskPosition : fallback.deskPosition,
      };

      return normalized;
    });

  const positionCounts = new Map<string, number>();
  for (const agent of normalizedAgents) {
    const key = `${agent.position[0].toFixed(2)},${agent.position[2].toFixed(2)}`;
    positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1);
  }

  return normalizedAgents.map((agent, index) => {
    const key = `${agent.position[0].toFixed(2)},${agent.position[2].toFixed(2)}`;
    const isOriginPile = Math.abs(agent.position[0]) < 0.01 && Math.abs(agent.position[2]) < 0.01;
    const isStacked = (positionCounts.get(key) ?? 0) > 1;
    if (!isOriginPile && !isStacked) return agent;

    const homePosition = getAgentHomePosition(index, agent.role);
    return {
      ...agent,
      position: homePosition,
      idlePosition: homePosition,
      deskPosition: homePosition,
    };
  });
}

export function FirebaseSync() {
  const { 
    isLoggedIn, 
    userProfile, 
    furniture,
    baseAgents,
    selectedFloor,
    setUserProfile, 
    setFurniture, 
    setBaseAgents,
    setIsLoggedIn,
    setAuthInitialized
  } = useOfficeStore();

  const loadedInitialProfile = useRef(false);
  const loadedInitialFurniture = useRef(false);
  const loadedInitialAgents = useRef(false);

  // 1. Handle Auth State and Fetch Initial Data ONCE
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setIsLoggedIn(true);
          loadedInitialProfile.current = false;
          
          const profileRef = ref(db, `users/${user.uid}/profile`);
          const profileSnap = await get(profileRef);
          if (profileSnap.exists()) {
            const data = profileSnap.val();
            const wallet = ensureLocalWallet(user.uid);
            if (!data.walletAddress || String(data.walletAddress).toLowerCase() !== wallet.address.toLowerCase()) {
              data.walletAddress = wallet.address;
              await set(profileRef, data);
              console.log("Linked real wallet for user:", wallet.address);
            }
            setUserProfile(data);
          } else if (user.displayName || user.email) {
            const wallet = ensureLocalWallet(user.uid);
            const newProfile: UserProfile = { 
              name: user.displayName || "",
              email: user.email || "",
              walletAddress: wallet.address,
              companyName: "New Agency",
              phone: "",
              gender: "male",
              outfit: "suit",
              skinTone: "#F1D3B3",
              eyeColor: "#332211",
              hairColor: "#111111"
            };
            await set(profileRef, newProfile);
            setUserProfile(newProfile);
            console.log("Created new profile with real wallet:", wallet.address);
          }
          loadedInitialProfile.current = true;
        } else {
          setIsLoggedIn(false);
          loadedInitialProfile.current = false;
          loadedInitialFurniture.current = false;
          loadedInitialAgents.current = false;
          setBaseAgents([]);
        }
      } catch (error) {
        console.error("Firebase auth sync failed:", error);
        setIsLoggedIn(Boolean(user));
      } finally {
        setAuthInitialized(true);
      }
    });

    return () => unsubscribeAuth();
  }, [setAuthInitialized, setIsLoggedIn, setUserProfile, setBaseAgents]);

  // Fetch Furniture and Agents When Floor Changes
  useEffect(() => {
    const fetchFloorData = async () => {
      if (isLoggedIn && auth.currentUser && selectedFloor !== null) {
        loadedInitialFurniture.current = false;
        loadedInitialAgents.current = false;
        setBaseAgents([]);
        
        const floorRef = ref(db, `users/${auth.currentUser.uid}/company/floors/${selectedFloor}`);
        const floorSnap = await get(floorRef);
        
        if (floorSnap.exists()) {
          const data = floorSnap.val();
          if (data.furniture) {
            setFurniture(data.furniture);
          } else {
            setFurniture(initialFurniture);
          }
          
          if (data.agents) {
            const agentsArray = Array.isArray(data.agents)
              ? data.agents
              : Object.values(data.agents);
            const normalizedAgents = normalizeAgents(agentsArray as unknown[]);
            setBaseAgents(normalizedAgents);
          } else {
            setBaseAgents([]);
          }
        } else {
          // If no custom data is saved for this floor, reset to default
          setFurniture(initialFurniture);
          setBaseAgents([]);
        }
        
        loadedInitialFurniture.current = true;
        loadedInitialAgents.current = true;
      }
    };
    
    void fetchFloorData();
  }, [isLoggedIn, selectedFloor, setFurniture, setBaseAgents]);

  // 2. Persist Profile Changes to DB
  useEffect(() => {
    if (isLoggedIn && auth.currentUser && loadedInitialProfile.current) {
      const profileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      set(profileRef, userProfile);
    }
  }, [userProfile, isLoggedIn]);

  // 3. Persist Furniture Changes to DB
  useEffect(() => {
    if (isLoggedIn && auth.currentUser && loadedInitialFurniture.current && selectedFloor !== null) {
      const furnitureRef = ref(db, `users/${auth.currentUser.uid}/company/floors/${selectedFloor}/furniture`);
      set(furnitureRef, furniture);
    }
  }, [furniture, isLoggedIn, selectedFloor]);

  // 4. Persist Base Agents to DB
  useEffect(() => {
    if (isLoggedIn && auth.currentUser && loadedInitialAgents.current && selectedFloor !== null) {
      const agentsRef = ref(db, `users/${auth.currentUser.uid}/company/floors/${selectedFloor}/agents`);
      set(agentsRef, baseAgents);
      void syncRuntimeAgentsForFloor(auth.currentUser.uid, selectedFloor, baseAgents).catch((error) => {
        console.error("Failed to sync runtime agents:", error);
      });
    }
  }, [baseAgents, isLoggedIn, selectedFloor]);

  return null; // This is a logic-only component
}
