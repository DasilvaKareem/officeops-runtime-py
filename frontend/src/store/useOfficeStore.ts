import { create } from "zustand";
import {
  type AgentState,
  type LogEntry,
  type TaskStep,
  buildInitialAgents,
  buildTaskSteps,
} from "@/src/lib/officeSim";
import { runOrchestratorStream, type OrchestratorEvent } from "@/src/lib/orchestrator/stream";
import type { OrchestratorArtifact } from "@/src/lib/orchestrator/stream";
import {
  dispatchAgentToFloor,
  persistRunArtifacts,
  startRuntimeRun,
  syncRuntimeAgentActivity,
  syncRuntimeRun,
} from "@/src/lib/companyRuntime";
import { auth } from "@/src/lib/firebase";

type Vec3 = [number, number, number];

const LOG_LIMIT = 80;
const RUN_LIMIT = 12;
const DEFAULT_STEP_PAYMENT = 0.001;
const CELEBRATION_MS = 4000;
const runControllers = new Map<string, AbortController>();

export type FurnitureItem = {
  id: string;
  type: "desk" | "deskAlt" | "chair" | "mug" | "plant" | "coffeeHeater" | "waterCooler";
  position: Vec3;
  rotation: Vec3;
  scale: number;
};

export type UserProfile = {
  name: string;
  companyName: string;
  email: string;
  phone: string;
  walletAddress?: string;
  gender: "male" | "female";
  outfit: "suit" | "casual" | "classy";
  skinTone: string;
  eyeColor: string;
  hairColor: string;
};

type RunStatus = "running" | "complete" | "error" | "cancelled";

type RunAgentSnapshot = {
  status: AgentState["status"];
  currentTask: string | null;
  spend: number;
  updatedAt: number;
};

export type WorkflowRun = {
  id: string;
  backendRunId?: string;
  prompt: string;
  goal: string;
  status: RunStatus;
  logs: LogEntry[];
  totalSteps: number;
  completedSteps: number;
  txCount: number;
  totalSpent: number;
  successMessage: string;
  assistantMessage: string;
  artifacts: OrchestratorArtifact[];
  agentStates: Partial<Record<string, RunAgentSnapshot>>;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

type OfficeState = {
  viewMode: "building" | "office";
  isLoggedIn: boolean;
  authInitialized: boolean;
  userProfile: UserProfile;
  selectedFloor: number | null;
  prompt: string;
  activeRunId: string | null;
  interactingAgentId: string | null;
  showElevatorModal: boolean;
  isRecording: boolean;
  runs: WorkflowRun[];
  baseAgents: AgentState[];
  agents: AgentState[];
  editMode: boolean;
  isControlling: boolean;
  furniture: FurnitureItem[];
  setViewMode: (mode: "building" | "office") => void;
  setIsLoggedIn: (status: boolean) => void;
  setAuthInitialized: (status: boolean) => void;
  setUserProfile: (profile: Partial<UserProfile>) => void;
  setSelectedFloor: (floor: number | null) => void;
  setPrompt: (prompt: string) => void;
  setInteractingAgentId: (id: string | null) => void;
  setShowElevatorModal: (show: boolean) => void;
  setIsRecording: (status: boolean) => void;
  selectRun: (runId: string) => void;
  runWorkflow: (promptOverride?: string) => Promise<void>;
  stopRun: (runId: string) => void;
  setEditMode: (editMode: boolean) => void;
  setIsControlling: (status: boolean) => void;
  setFurniture: (furniture: FurnitureItem[]) => void;
  setBaseAgents: (agents: AgentState[]) => void;
  addAgent: (agent: AgentState) => void;
  updateAgent: (agentId: string, updates: Partial<AgentState>) => void;
  dispatchAgentToFloor: (agentId: string, targetFloorId: number, reason: string) => Promise<void>;
  updateFurnitureItem: (id: string, updates: Partial<FurnitureItem>) => void;
  addFurnitureItem: (item: FurnitureItem) => void;
  removeFurnitureItem: (id: string) => void;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function fmtMoney(value: number) {
  return `$${value.toFixed(4)}`;
}

function walletStorageKey(uid: string) {
  return `officeops_wallet_pk_${uid}`;
}

function appendLog(entry: Omit<LogEntry, "id" | "at">): LogEntry {
  return { id: uid(), at: Date.now(), ...entry };
}

const DESK_LAYOUT: Vec3[] = [
  [0, 0, -3.2],
  [-2.8, 0, -0.8],
  [2.8, 0, -0.8],
  [-1.6, 0, 2.1],
  [1.6, 0, 2.1],
];

export const initialFurniture: FurnitureItem[] = [];
DESK_LAYOUT.forEach((pos, i) => {
  const deskId = `desk-${i}`;
  initialFurniture.push({
    id: deskId,
    type: i % 2 === 0 ? "desk" : "deskAlt",
    position: [pos[0], 0, pos[2]],
    rotation: [0, 0, 0],
    scale: 0.58,
  });
  initialFurniture.push({
    id: `chair-${i}`,
    type: "chair",
    position: [pos[0], 0, pos[2] + 0.86],
    rotation: [0, Math.PI, 0],
    scale: 0.56,
  });
  initialFurniture.push({
    id: `mug-${i}`,
    type: "mug",
    position: [pos[0] + 0.42, 0.42, pos[2] - 0.1],
    rotation: [0, 0, 0],
    scale: 0.26,
  });
  initialFurniture.push({
    id: `plant-${i}`,
    type: "plant",
    position: [pos[0] - 0.45, 0.42, pos[2] - 0.1],
    rotation: [0, 0, 0],
    scale: 0.28,
  });
  initialFurniture.push({
    id: `coffee-${i}`,
    type: "coffeeHeater",
    position: [pos[0], 0.42, pos[2] - 0.18],
    rotation: [0, 0, 0],
    scale: 0.28,
  });
});

initialFurniture.push({
  id: "water-cooler",
  type: "waterCooler",
  position: [5.25, 0, -2.25],
  rotation: [0, -Math.PI / 2, 0],
  scale: 0.62,
});

const agentAliases: Record<string, string[]> = {
  manager: ["manager", "ceo", "lead", "planner", "router"],
  research: ["research", "researcher", "analyst", "requirements"],
  writer: ["writer", "copywriter", "content", "task"],
  finance: ["finance", "financial", "budget", "accounting", "developer", "code"],
  qa: ["qa", "quality", "review", "verifier", "testing", "security", "deploy"],
};

function resolveAgentId(raw?: string, candidates: AgentState[] = []): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const exactMatch = candidates.find((agent) => agent.id.toLowerCase() === lower);
  if (exactMatch) return exactMatch.id;

  const textMatch = candidates.find((agent) => {
    const id = agent.id.toLowerCase();
    const label = agent.label.toLowerCase();
    const role = agent.role.toLowerCase();
    return lower.includes(id) || lower.includes(label) || lower.includes(role);
  });
  if (textMatch) return textMatch.id;

  for (const [agentId, aliases] of Object.entries(agentAliases)) {
    if (aliases.some((alias) => lower.includes(alias))) return agentId;
  }
  return null;
}

function createRun(prompt: string, totalSteps: number): WorkflowRun {
  const now = Date.now();
  return {
    id: uid(),
    prompt,
    goal: prompt,
    status: "running",
    logs: [
      appendLog({ tone: "info", text: "Streaming orchestrator events..." }),
      appendLog({ tone: "info", text: `Created ${totalSteps} steps. Connecting orchestrator...` }),
    ],
    totalSteps,
    completedSteps: 0,
    txCount: 0,
    totalSpent: 0,
    successMessage: "",
    assistantMessage: "",
    artifacts: [],
    agentStates: {},
    startedAt: now,
    updatedAt: now,
  };
}

function updateRunList(
  runs: WorkflowRun[],
  runId: string,
  updater: (run: WorkflowRun) => WorkflowRun
): WorkflowRun[] {
  let changed = false;
  const nextRuns = runs.map((run) => {
    if (run.id !== runId) return run;
    changed = true;
    return updater(run);
  });
  return changed ? nextRuns : runs;
}

function appendRunLog(run: WorkflowRun, entry: Omit<LogEntry, "id" | "at">): WorkflowRun {
  return {
    ...run,
    logs: [appendLog(entry), ...run.logs].slice(0, LOG_LIMIT),
    updatedAt: Date.now(),
  };
}

function extractAssistantMessage(artifacts?: OrchestratorArtifact[]): string | null {
  if (!artifacts || artifacts.length === 0) return null;
  const response = artifacts.find((artifact) => artifact.stage === "assistant")
    ?? artifacts.find((artifact) => artifact.fileName.toLowerCase() === "assistant-response.md");
  const content = response?.content.trim();
  return content || null;
}

function fallbackAssistantMessage(prompt: string) {
  const compact = prompt.toLowerCase().replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();
  if (compact.includes("capital")) {
    if (compact.includes("united states") || compact.includes("usa")) {
      return "The capital of the United States is Washington, D.C.";
    }

    const stateCapitals: Array<[string, string, string]> = [
      ["alabama", "Alabama", "Montgomery"],
      ["alaska", "Alaska", "Juneau"],
      ["arizona", "Arizona", "Phoenix"],
      ["arkansas", "Arkansas", "Little Rock"],
      ["california", "California", "Sacramento"],
      ["califonria", "California", "Sacramento"],
      ["colorado", "Colorado", "Denver"],
      ["connecticut", "Connecticut", "Hartford"],
      ["delaware", "Delaware", "Dover"],
      ["florida", "Florida", "Tallahassee"],
      ["georgia", "Georgia", "Atlanta"],
      ["hawaii", "Hawaii", "Honolulu"],
      ["idaho", "Idaho", "Boise"],
      ["illinois", "Illinois", "Springfield"],
      ["indiana", "Indiana", "Indianapolis"],
      ["iowa", "Iowa", "Des Moines"],
      ["kansas", "Kansas", "Topeka"],
      ["kentucky", "Kentucky", "Frankfort"],
      ["louisiana", "Louisiana", "Baton Rouge"],
      ["maine", "Maine", "Augusta"],
      ["maryland", "Maryland", "Annapolis"],
      ["massachusetts", "Massachusetts", "Boston"],
      ["michigan", "Michigan", "Lansing"],
      ["minnesota", "Minnesota", "St. Paul"],
      ["mississippi", "Mississippi", "Jackson"],
      ["missouri", "Missouri", "Jefferson City"],
      ["montana", "Montana", "Helena"],
      ["nebraska", "Nebraska", "Lincoln"],
      ["nevada", "Nevada", "Carson City"],
      ["new hampshire", "New Hampshire", "Concord"],
      ["new jersey", "New Jersey", "Trenton"],
      ["new mexico", "New Mexico", "Santa Fe"],
      ["new york", "New York", "Albany"],
      ["north carolina", "North Carolina", "Raleigh"],
      ["north dakota", "North Dakota", "Bismarck"],
      ["ohio", "Ohio", "Columbus"],
      ["oklahoma", "Oklahoma", "Oklahoma City"],
      ["oregon", "Oregon", "Salem"],
      ["pennsylvania", "Pennsylvania", "Harrisburg"],
      ["rhode island", "Rhode Island", "Providence"],
      ["south carolina", "South Carolina", "Columbia"],
      ["south dakota", "South Dakota", "Pierre"],
      ["tennessee", "Tennessee", "Nashville"],
      ["tennesse", "Tennessee", "Nashville"],
      ["texas", "Texas", "Austin"],
      ["utah", "Utah", "Salt Lake City"],
      ["vermont", "Vermont", "Montpelier"],
      ["virginia", "Virginia", "Richmond"],
      ["washington", "Washington", "Olympia"],
      ["west virginia", "West Virginia", "Charleston"],
      ["wisconsin", "Wisconsin", "Madison"],
      ["wyoming", "Wyoming", "Cheyenne"],
    ];

    const match = stateCapitals.find(([stateName]) => compact.includes(stateName));
    if (match) {
      return `The capital of ${match[1]} is ${match[2]}.`;
    }
  }
  return "The orchestrator finished without a direct assistant answer. Check the runtime model configuration and generated artifacts for details.";
}

function updateRunAgent(
  run: WorkflowRun,
  agentId: string,
  updater: (snapshot: RunAgentSnapshot | undefined) => RunAgentSnapshot
): WorkflowRun {
  return {
    ...run,
    agentStates: {
      ...run.agentStates,
      [agentId]: updater(run.agentStates[agentId]),
    },
    updatedAt: Date.now(),
  };
}

function buildAggregateAgents(runs: WorkflowRun[], baseAgents: AgentState[]): AgentState[] {
  const now = Date.now();

  return baseAgents.map((baseAgent) => {
    const snapshots = runs
      .map((run) => ({ run, snapshot: run.agentStates[baseAgent.id] }))
      .filter((entry): entry is { run: WorkflowRun; snapshot: RunAgentSnapshot } => Boolean(entry.snapshot));

    const totalSpend = snapshots.reduce((sum, entry) => sum + entry.snapshot.spend, 0);
    const active = snapshots
      .filter((entry) => {
        if (entry.run.status !== "running") return false;
        const status = entry.snapshot.status;
        return status === "moving" || status === "working" || status === "standing" || status === "returning";
      })
      .sort((a, b) => b.snapshot.updatedAt - a.snapshot.updatedAt);

    const celebrating = snapshots.some(
      (entry) => entry.run.status === "complete" && entry.run.finishedAt && now - entry.run.finishedAt < CELEBRATION_MS
    );
    const failed = snapshots.some(
      (entry) => entry.run.status === "error" && entry.run.finishedAt && now - entry.run.finishedAt < CELEBRATION_MS
    );
    const cancelled = snapshots.some(
      (entry) => entry.run.status === "cancelled" && entry.run.finishedAt && now - entry.run.finishedAt < CELEBRATION_MS
    );

    let status: AgentState["status"] = "idle";
    let currentTask: string | null = null;

    if (active.length > 0) {
      status = active.some((entry) => entry.snapshot.status === "working") ? "working" : "moving";
      currentTask = active.length > 1 ? `${active.length} active tasks` : active[0].snapshot.currentTask;
    } else if (failed) {
      status = "failed";
      currentTask = "Failed";
    } else if (cancelled) {
      status = "idle";
      currentTask = "Stopped";
    } else if (celebrating) {
      status = "celebrating";
      currentTask = "Done!";
    }

    return {
      ...baseAgent,
      balance: baseAgent.balance + totalSpend,
      status,
      currentTask,
      position: baseAgent.position ?? baseAgent.idlePosition ?? [0, 0.1, 0],
    };
  });
}

function scheduleAggregateRefresh() {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    useOfficeStore.setState((state) => ({
      agents: buildAggregateAgents(state.runs, state.baseAgents),
    }));
  }, CELEBRATION_MS);
}

function getRuntimeContext() {
  const userId = auth.currentUser?.uid;
  const floorId = useOfficeStore.getState().selectedFloor;
  if (!userId || floorId === null) return null;
  return { userId, floorId };
}

function persistRuntimeRunSnapshot(runId: string) {
  const context = getRuntimeContext();
  if (!context) return;
  const run = useOfficeStore.getState().runs.find((entry) => entry.id === runId);
  if (!run) return;
  void syncRuntimeRun(context.userId, context.floorId, run).catch((error) => {
    console.error("Failed to sync runtime run:", error);
  });
}

function persistRuntimeAgentSnapshot(runId: string, agentId: string) {
  const context = getRuntimeContext();
  if (!context) return;

  const state = useOfficeStore.getState();
  const agent = state.agents.find((entry) => entry.id === agentId) ?? state.baseAgents.find((entry) => entry.id === agentId);
  const run = state.runs.find((entry) => entry.id === runId);
  if (!agent || !run) return;

  const snapshot = run.agentStates[agentId];
  const currentTask = snapshot?.currentTask ?? agent.currentTask ?? null;
  const currentAction = snapshot?.status ?? agent.status;
  void syncRuntimeAgentActivity(context.userId, context.floorId, runId, agent, currentTask, currentAction).catch((error) => {
    console.error("Failed to sync runtime agent activity:", error);
  });
}

export const useOfficeStore = create<OfficeState>((set, get) => ({
  viewMode: "building",
  isLoggedIn: false,
  authInitialized: false,
  userProfile: {
    name: "",
    companyName: "",
    email: "",
    phone: "",
    gender: "male",
    outfit: "suit",
    skinTone: "#F1D3B3",
    eyeColor: "#332211",
    hairColor: "#111111",
  },
  selectedFloor: null,
  prompt: "",
  activeRunId: null,
  interactingAgentId: null,
  showElevatorModal: false,
  isRecording: false,
  runs: [],
  baseAgents: [],
  agents: [],
  editMode: false,
  isControlling: false,
  furniture: initialFurniture,
  setViewMode: (viewMode) => set({ viewMode }),
  setIsLoggedIn: (isLoggedIn) =>
    set((state) => {
      if (isLoggedIn) return { isLoggedIn };
      return {
        isLoggedIn: false,
        baseAgents: [],
        agents: [],
        runs: [],
        activeRunId: null,
        interactingAgentId: null,
      };
    }),
  setAuthInitialized: (authInitialized) => set({ authInitialized }),
  setUserProfile: (profile) =>
    set((state) => ({
      userProfile: { ...state.userProfile, ...profile },
    })),
  setSelectedFloor: (selectedFloor) => set({ selectedFloor }),
  setPrompt: (prompt) => set({ prompt }),
  setInteractingAgentId: (interactingAgentId) => set({ interactingAgentId }),
  setShowElevatorModal: (showElevatorModal) => set({ showElevatorModal }),
  setIsRecording: (isRecording) => set({ isRecording }),
  selectRun: (activeRunId) => set({ activeRunId }),
  stopRun: (runId) => {
    runControllers.get(runId)?.abort();
  },
  setEditMode: (editMode) => set({ editMode }),
  setIsControlling: (isControlling) => set({ isControlling }),
  setFurniture: (furniture) => set({ furniture }),
  setBaseAgents: (baseAgents) => set((state) => ({ baseAgents, agents: buildAggregateAgents(state.runs, baseAgents) })),
  addAgent: (agent) => set((state) => {
    const newBaseAgents = [...state.baseAgents, agent];
    return {
      baseAgents: newBaseAgents,
      agents: buildAggregateAgents(state.runs, newBaseAgents)
    };
  }),
  updateAgent: (agentId, updates) => set((state) => {
    const newBaseAgents = state.baseAgents.map((agent) =>
      agent.id === agentId ? { ...agent, ...updates, id: agent.id } : agent
    );
    return {
      baseAgents: newBaseAgents,
      agents: buildAggregateAgents(state.runs, newBaseAgents),
    };
  }),
  dispatchAgentToFloor: async (agentId, targetFloorId, reason) => {
    const state = get();
    const userId = auth.currentUser?.uid;
    const fromFloorId = state.selectedFloor;
    const agent = state.baseAgents.find((entry) => entry.id === agentId);
    if (!userId || fromFloorId === null || !agent || fromFloorId === targetFloorId) return;

    await dispatchAgentToFloor(userId, agent, fromFloorId, targetFloorId, reason);

    set((currentState) => {
      const nextBaseAgents = currentState.baseAgents.filter((entry) => entry.id !== agentId);
      return {
        baseAgents: nextBaseAgents,
        agents: buildAggregateAgents(currentState.runs, nextBaseAgents),
      };
    });
  },
  updateFurnitureItem: (id, updates) =>
    set((state) => ({
      furniture: state.furniture.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    })),
  addFurnitureItem: (item) =>
    set((state) => ({
      furniture: [...state.furniture, item],
    })),
  removeFurnitureItem: (id) =>
    set((state) => ({
      furniture: state.furniture.filter((item) => item.id !== id),
    })),
  runWorkflow: async (promptOverride) => {
    const prompt = (promptOverride ?? get().prompt).trim();
    if (!prompt) return;
    if (get().baseAgents.length === 0) return;

    const steps = buildTaskSteps(prompt);
    const run = createRun(prompt, steps.length);
    const runId = run.id;
    const controller = new AbortController();
    runControllers.set(runId, controller);

    const updateRun = (updater: (runState: WorkflowRun) => WorkflowRun) => {
      set((state) => {
        const runs = updateRunList(state.runs, runId, updater);
        if (runs === state.runs) return state;
        return {
          runs,
          agents: buildAggregateAgents(runs, state.baseAgents),
        };
      });
    };

    const markRunFinished = (status: RunStatus, message: string, tone: "success" | "warning") => {
      updateRun((runState) => {
        if (runState.status !== "running") return runState;
        return appendRunLog(
          {
            ...runState,
            status,
            successMessage: message,
            finishedAt: Date.now(),
          },
          { tone, text: message }
        );
      });
      runControllers.delete(runId);
      scheduleAggregateRefresh();
      persistRuntimeRunSnapshot(runId);
      if (status === "complete") {
        const context = getRuntimeContext();
        const finishedRun = useOfficeStore.getState().runs.find((entry) => entry.id === runId);
        if (context && finishedRun) {
          void persistRunArtifacts(context.userId, context.floorId, finishedRun, finishedRun.artifacts)
            .then(() => {
              persistRuntimeRunSnapshot(runId);
            })
            .catch((error) => {
              console.error("Failed to persist run artifacts:", error);
            });
        }
      }
    };

    set((state) => {
      const runs = [run, ...state.runs].slice(0, RUN_LIMIT);
      return {
        runs,
        activeRunId: runId,
        prompt: promptOverride ? state.prompt : "",
        agents: buildAggregateAgents(runs, state.baseAgents),
      };
    });
    const context = getRuntimeContext();
    if (context) {
      void startRuntimeRun(context.userId, context.floorId, run).catch((error) => {
        console.error("Failed to start runtime run:", error);
      });
    }

    const userId = auth.currentUser?.uid;
    const buyerPrivateKey = userId ? localStorage.getItem(walletStorageKey(userId)) : null;
    const nanopayEnabled = process.env.NEXT_PUBLIC_ENABLE_NANOPAYMENTS === "true";
    const leadAgentId = get().baseAgents[0]?.id ?? null;

    const runLocalFallback = async () => {
      const MAX_BALANCE = 12.452;
      for (const step of steps) {
        const currentSpent = get().runs.find(r => r.id === runId)?.totalSpent ?? 0;
        if (currentSpent + step.payment > MAX_BALANCE) {
          updateRun((runState) => 
            appendRunLog(runState, { tone: "warning", text: "INSUFFICIENT FUNDS: CEO Wallet needs more USDC" })
          );
          markRunFinished("error", "Workflow halted due to insufficient funds.", "warning");
          return;
        }
        updateRun((runState) =>
          appendRunLog(
            updateRunAgent(runState, step.agentId, (snapshot) => ({
              status: "moving",
              currentTask: step.text,
              spend: snapshot?.spend || 0,
              updatedAt: Date.now(),
            })),
            { tone: "info", text: `${step.role.toUpperCase()} started: ${step.text}` }
          )
        );
        persistRuntimeRunSnapshot(runId);
        persistRuntimeAgentSnapshot(runId, step.agentId);

        await sleep(1400);

        updateRun((runState) =>
          updateRunAgent(runState, step.agentId, (snapshot) => ({
            status: "working",
            currentTask: step.text,
            spend: snapshot?.spend || 0,
            updatedAt: Date.now(),
          }))
        );
        persistRuntimeRunSnapshot(runId);
        persistRuntimeAgentSnapshot(runId, step.agentId);

        await sleep(1200);

        updateRun((runState) =>
          appendRunLog(
            updateRunAgent(runState, step.agentId, (snapshot) => ({
              status: "idle",
              currentTask: null,
              spend: (snapshot?.spend || 0) + step.payment,
              updatedAt: Date.now(),
            })),
            { tone: "success", text: `${step.role.toUpperCase()} completed`, amount: step.payment }
          )
        );

        updateRun((runState) => ({
          ...runState,
          txCount: runState.txCount + 1,
          totalSpent: runState.totalSpent + step.payment,
          completedSteps: runState.completedSteps + 1,
          updatedAt: Date.now(),
        }));
        persistRuntimeRunSnapshot(runId);
        persistRuntimeAgentSnapshot(runId, step.agentId);
      }

      const finished = get().runs.find((entry) => entry.id === runId);
      if (!finished || finished.status !== "running") return;
      const assistantMessage = fallbackAssistantMessage(finished.prompt);
      updateRun((runState) => ({
        ...runState,
        assistantMessage,
        updatedAt: Date.now(),
      }));
      markRunFinished(
        "complete",
        assistantMessage,
        "success"
      );
    };

    if (nanopayEnabled && userId && buyerPrivateKey?.startsWith("0x")) {
      if (leadAgentId) {
        updateRun((runState) =>
          appendRunLog(
            updateRunAgent(runState, leadAgentId, (snapshot) => ({
              status: "moving",
              currentTask: "Authorizing Circle nanopayment",
              spend: snapshot?.spend || 0,
              updatedAt: Date.now(),
            })),
            { tone: "info", text: "Requesting wallet-backed nanopayment..." }
          )
        );
      }
      persistRuntimeRunSnapshot(runId);
      if (leadAgentId) persistRuntimeAgentSnapshot(runId, leadAgentId);

      try {
        const paidResponse = await fetch("/api/nanopay/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            userId,
            floorId: get().selectedFloor ?? 7,
            buyerPrivateKey,
          }),
          signal: controller.signal,
        });

        const paidPayload = await paidResponse.json();
        if (!paidResponse.ok || !paidPayload?.ok) {
          throw new Error(paidPayload?.error ?? `Nanopayment route failed (${paidResponse.status})`);
        }

        const paidData = paidPayload.data as {
          ok?: boolean;
          payment?: {
            transaction?: string;
            amountUsdc?: number;
            agentPayouts?: Array<{ agentId?: string; amountUsdc?: number }>;
          };
          state?: {
            run_id?: string;
            artifacts?: Array<Record<string, unknown>>;
            logs?: Array<{ message?: string; stage?: string; level?: string }>;
          };
        };
        const runtimeState = paidData?.state as {
          run_id?: string;
          artifacts?: Array<Record<string, unknown>>;
          logs?: Array<{ message?: string; stage?: string; level?: string }>;
        };
        const txHash = typeof paidData?.payment?.transaction === "string"
          ? paidData.payment.transaction
          : typeof paidPayload.transaction === "string"
            ? paidPayload.transaction
            : undefined;
        const paymentAmountUsdc = paidData?.payment?.amountUsdc;
        const amount = typeof paymentAmountUsdc === "number" && Number.isFinite(paymentAmountUsdc)
          ? paymentAmountUsdc
          : Number.parseFloat(String(paidPayload.amount ?? "0"));
        const paidAmount = Number.isFinite(amount) && amount > 0 ? amount : DEFAULT_STEP_PAYMENT;
        const now = Date.now();

        const artifacts: OrchestratorArtifact[] = Array.isArray(runtimeState?.artifacts)
          ? runtimeState.artifacts.map((item) => ({
              fileName: typeof item.file_name === "string" ? item.file_name : "artifact.txt",
              mimeType: typeof item.mime_type === "string" ? item.mime_type : "text/plain",
              content: typeof item.content === "string" ? item.content : "",
              kind: (typeof item.kind === "string" ? item.kind : "report") as OrchestratorArtifact["kind"],
              agentName: typeof item.agent_name === "string" ? item.agent_name : undefined,
              stage: typeof item.stage === "string" ? item.stage : undefined,
            }))
          : [];
        const assistantMessage = extractAssistantMessage(artifacts) ?? "Paid run completed.";

        const agentIds = get().baseAgents.map((agent) => agent.id);
        const payoutByAgent = new Map<string, number>();
        const backendPayouts = paidData?.payment?.agentPayouts;
        if (Array.isArray(backendPayouts)) {
          for (const payout of backendPayouts) {
            if (!payout?.agentId) continue;
            const amountUsdc = Number(payout.amountUsdc ?? 0);
            if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) continue;
            payoutByAgent.set(payout.agentId, amountUsdc);
          }
        }
        const payoutPerAgent = paidAmount / Math.max(1, agentIds.length);

        updateRun((runState) => {
          let nextState: WorkflowRun = {
            ...runState,
            backendRunId: runtimeState?.run_id || runState.backendRunId,
            artifacts: artifacts.length > 0 ? artifacts : runState.artifacts,
            assistantMessage,
            completedSteps: runState.totalSteps,
            txCount: runState.txCount + 1,
            totalSpent: runState.totalSpent + paidAmount,
            updatedAt: now,
          };

          for (const agentId of agentIds) {
            nextState = updateRunAgent(nextState, agentId, (snapshot) => ({
              status: "idle",
              currentTask: null,
              spend: (snapshot?.spend || 0) + (payoutByAgent.get(agentId) ?? payoutPerAgent),
              updatedAt: now,
            }));
          }

          if (Array.isArray(runtimeState?.logs)) {
            for (const log of runtimeState.logs.slice(-8)) {
              if (!log?.message) continue;
              nextState = appendRunLog(nextState, {
                tone: "info",
                text: `[${log.stage || log.level || "runtime"}] ${log.message}`,
              });
            }
          }

          return appendRunLog(nextState, {
            tone: "success",
            text: txHash ? `Nanopayment settled: ${txHash}` : "Nanopayment settled.",
            amount: paidAmount,
          });
        });

        persistRuntimeRunSnapshot(runId);
        for (const agentId of agentIds) persistRuntimeAgentSnapshot(runId, agentId);
        markRunFinished("complete", assistantMessage, "success");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          updateRun((runState) =>
            appendRunLog(
              {
                ...runState,
                status: "cancelled",
                successMessage: "Run stopped.",
                finishedAt: Date.now(),
              },
              { tone: "warning", text: "Run stopped." }
            )
          );
          runControllers.delete(runId);
          scheduleAggregateRefresh();
          persistRuntimeRunSnapshot(runId);
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        updateRun((runState) =>
          appendRunLog(runState, {
            tone: "warning",
            text: `Nanopayment path failed (${message}). Falling back to direct runtime stream.`,
          })
        );
      }
    }

    try {
      await runOrchestratorStream({
        prompt,
        userId: auth.currentUser?.uid,
        floorId: get().selectedFloor ?? 7,
        signal: controller.signal,
        onEvent: (event: OrchestratorEvent) => {
          const now = Date.now();

          if (event.kind === "workflow_started") {
            updateRun((runState) => {
              const next = event.totalSteps && event.totalSteps > 0 ? event.totalSteps : runState.totalSteps;
              const withMeta = {
                ...runState,
                backendRunId: event.runId || runState.backendRunId,
                totalSteps: next,
                updatedAt: now,
              };
              return event.text ? appendRunLog(withMeta, { tone: "info", text: event.text }) : withMeta;
            });
            persistRuntimeRunSnapshot(runId);
            return;
          }

          if (event.kind === "message") {
            updateRun((runState) =>
              appendRunLog(
                {
                  ...runState,
                  backendRunId: event.runId || runState.backendRunId,
                },
                { tone: "info", text: event.text }
              )
            );
            persistRuntimeRunSnapshot(runId);
            return;
          }

          if (event.kind === "agent_started") {
            const agentId = resolveAgentId(event.agent ?? event.text, get().baseAgents);
            if (!agentId) {
              const rawText = event.text ?? event.agent;
              if (!rawText) return;
              updateRun((runState) =>
                appendRunLog(
                  {
                    ...runState,
                    backendRunId: event.runId || runState.backendRunId,
                  },
                  { tone: "info", text: rawText }
                )
              );
              return;
            }

            updateRun((runState) =>
              appendRunLog(
                updateRunAgent(
                  {
                    ...runState,
                    backendRunId: event.runId || runState.backendRunId,
                  },
                  agentId,
                  (snapshot) => ({
                    status: "moving",
                    currentTask: event.text ?? "Working on assigned task",
                    spend: snapshot?.spend || 0,
                    updatedAt: now,
                  })
                ),
                { tone: "info", text: `${agentId.toUpperCase()} started task` }
              )
            );
            persistRuntimeRunSnapshot(runId);
            persistRuntimeAgentSnapshot(runId, agentId);
            return;
          }

          if (event.kind === "agent_stream") {
            const agentId = resolveAgentId(event.agent ?? event.text, get().baseAgents);
            if (!agentId) return;
            updateRun((runState) =>
              updateRunAgent(
                {
                  ...runState,
                  backendRunId: event.runId || runState.backendRunId,
                },
                agentId,
                (snapshot) => ({
                  status: "working",
                  currentTask: snapshot?.currentTask || "Streaming output",
                  spend: snapshot?.spend || 0,
                  updatedAt: now,
                })
              )
            );
            persistRuntimeRunSnapshot(runId);
            persistRuntimeAgentSnapshot(runId, agentId);
            return;
          }

          if (event.kind === "agent_completed") {
            const agentId = resolveAgentId(event.agent ?? event.text, get().baseAgents);
            const amount = event.amount ?? DEFAULT_STEP_PAYMENT;

            if (!agentId) {
              updateRun((runState) =>
                appendRunLog(
                  {
                    ...runState,
                    backendRunId: event.runId || runState.backendRunId,
                    completedSteps: runState.completedSteps + 1,
                    txCount: runState.txCount + 1,
                    totalSpent: runState.totalSpent + amount,
                    updatedAt: now,
                  },
                  { tone: "success", text: event.text ?? "Step completed", amount }
                )
              );
              persistRuntimeRunSnapshot(runId);
              return;
            }

            updateRun((runState) =>
              appendRunLog(
                updateRunAgent(
                  {
                    ...runState,
                    backendRunId: event.runId || runState.backendRunId,
                    completedSteps: runState.completedSteps + 1,
                    txCount: runState.txCount + 1,
                    totalSpent: runState.totalSpent + amount,
                    updatedAt: now,
                  },
                  agentId,
                  (snapshot) => ({
                    status: "idle",
                    currentTask: null,
                    spend: (snapshot?.spend || 0) + amount,
                    updatedAt: now,
                  })
                ),
                { tone: "success", text: `${agentId.toUpperCase()} completed`, amount }
              )
            );
            persistRuntimeRunSnapshot(runId);
            persistRuntimeAgentSnapshot(runId, agentId);
            return;
          }

          if (event.kind === "agent_failed") {
            const agentId = resolveAgentId(event.agent ?? event.text, get().baseAgents);
            updateRun((runState) => {
              const withStatus = {
                ...runState,
                backendRunId: event.runId || runState.backendRunId,
                status: "error" as const,
                successMessage: event.text ?? event.error ?? "Workflow failed.",
                finishedAt: now,
                updatedAt: now,
              };
              const withAgent = agentId
                ? updateRunAgent(withStatus, agentId, (snapshot) => ({
                    status: "failed",
                    currentTask: event.text ?? event.error ?? "Failed",
                    spend: snapshot?.spend || 0,
                    updatedAt: now,
                  }))
                : withStatus;
              return appendRunLog(withAgent, {
                tone: "warning",
                text: event.text ?? event.error ?? "Workflow failed.",
              });
            });
            persistRuntimeRunSnapshot(runId);
            if (agentId) persistRuntimeAgentSnapshot(runId, agentId);
            return;
          }

          if (event.kind === "payment") {
            const amount = event.amount;
            const paymentText =
              event.fromAgent && event.toAgent
                ? `${event.fromAgent} -> ${event.toAgent}${amount ? ` ${fmtMoney(amount)}` : ""}`
                : `Payment event${amount ? ` ${fmtMoney(amount)}` : ""}`;

            updateRun((runState) =>
              appendRunLog(
                {
                  ...runState,
                  backendRunId: event.runId || runState.backendRunId,
                },
                { tone: "info", text: paymentText, amount }
              )
            );
            persistRuntimeRunSnapshot(runId);
            return;
          }

          if (event.kind === "workflow_failed") {
            markRunFinished("error", event.text, "warning");
            return;
          }

          if (event.kind === "workflow_completed") {
            const artifacts = event.artifacts && event.artifacts.length > 0 ? event.artifacts : undefined;
            const assistantMessage = extractAssistantMessage(artifacts);
            updateRun((runState) => ({
              ...runState,
              backendRunId: event.runId || runState.backendRunId,
              artifacts: artifacts ?? runState.artifacts,
              assistantMessage: assistantMessage ?? runState.assistantMessage,
              updatedAt: now,
            }));

            const finished = get().runs.find((entry) => entry.id === runId);
            if (!finished || finished.status !== "running") return;
            markRunFinished(
              "complete",
              assistantMessage ?? event.text ?? `Task finished. Spent ${fmtMoney(finished.totalSpent)}.`,
              "success"
            );
          }
        },
      });

      const activeRun = get().runs.find((entry) => entry.id === runId);
      if (activeRun?.status === "running") {
        markRunFinished(
          "complete",
          `Task finished. ${activeRun.completedSteps}/${activeRun.totalSteps} steps complete, spent ${fmtMoney(activeRun.totalSpent)}.`,
          "success"
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updateRun((runState) =>
          appendRunLog(
            {
              ...runState,
              status: "cancelled",
              successMessage: "Run stopped.",
              finishedAt: Date.now(),
            },
            { tone: "warning", text: "Run stopped." }
          )
        );
        runControllers.delete(runId);
        scheduleAggregateRefresh();
        persistRuntimeRunSnapshot(runId);
        return;
      }

      const message = error instanceof Error ? error.message : String(error);

      updateRun((runState) =>
        appendRunLog(runState, {
          tone: "warning",
          text: `Orchestrator unavailable (${message}). Running local fallback.`,
        })
      );

      await runLocalFallback();
    }
  },
}));

export function useProgressPercent() {
  const activeRunId = useOfficeStore((s) => s.activeRunId);
  const run = useOfficeStore((s) => s.runs.find((entry) => entry.id === activeRunId) ?? s.runs[0]);
  if (!run?.totalSteps) return 0;
  return Math.min(100, Math.round((run.completedSteps / run.totalSteps) * 100));
}

export function formatUsdc(value: number) {
  return `${value.toFixed(3)} USDC`;
}

export function workflowSteps(steps: TaskStep[]) {
  return steps;
}
