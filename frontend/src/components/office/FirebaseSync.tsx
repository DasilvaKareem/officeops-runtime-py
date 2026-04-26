"use client";

import { useEffect, useRef } from "react";
import { auth, db } from "@/src/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ref, get, set } from "firebase/database";
import { buildInitialAgents, coerceAgentModelPath, type AgentState } from "@/src/lib/officeSim";
import { useOfficeStore, initialFurniture, type UserProfile } from "@/src/store/useOfficeStore";
import { syncRuntimeAgentsForFloor } from "@/src/lib/companyRuntime";

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

  return rawAgents
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
            if (!data.walletAddress) {
              const newAddress = `0x${Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
              data.walletAddress = newAddress;
              await set(profileRef, data);
              console.log("Generated new wallet for user:", newAddress);
            }
            setUserProfile(data);
          } else if (user.displayName || user.email) {
            const newAddress = `0x${Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
            const newProfile: UserProfile = { 
              name: user.displayName || "",
              email: user.email || "",
              walletAddress: newAddress,
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
            console.log("Created new profile with wallet:", newAddress);
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
