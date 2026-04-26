export type AgentRole = "research" | "writer" | "finance" | "qa" | "manager";
export type AgentStatus = "idle" | "moving" | "working" | "standing" | "returning" | "celebrating" | "failed";

export type AgentState = {
  id: string;
  role: AgentRole;
  label: string;
  color: string;
  skinTone: string;
  eyeColor: string;
  hairColor: string;
  modelPath: string;
  status: AgentStatus;
  balance: number;
  currentTask: string | null;
  position: [number, number, number];
  idlePosition: [number, number, number];
  deskPosition: [number, number, number];
};

export type TaskStep = {
  id: string;
  agentId: string;
  role: AgentRole;
  text: string;
  payment: number;
};

export type LogEntry = {
  id: string;
  at: number;
  tone: "info" | "success" | "warning";
  text: string;
  amount?: number;
};

export const AGENT_ORDER: AgentRole[] = [
  "manager",
  "research",
  "writer",
  "finance",
  "qa",
];

export const AGENT_LABELS: Record<AgentRole, string> = {
  manager: "Router Agent",
  research: "Requirements Analyst",
  writer: "Task Planner",
  finance: "Developer",
  qa: "Code Reviewer",
};

const COLORS: Record<AgentRole, string> = {
  manager: "#8b5cf6",
  research: "#22c55e",
  writer: "#3b82f6",
  finance: "#ef4444",
  qa: "#06b6d4",
};

const MODELS: Record<AgentRole, string> = {
  manager: "/models/characters/OldClassy_Male.gltf",
  research: "/models/characters/Casual2_Male.gltf",
  writer: "/models/characters/Casual3_Female.gltf",
  finance: "/models/characters/OldClassy_Male.gltf",
  qa: "/models/characters/OldClassy_Female.gltf",
};

const NON_SUIT_AGENT_MODELS = [
  "/models/characters/Casual2_Male.gltf",
  "/models/characters/Casual3_Female.gltf",
  "/models/characters/OldClassy_Male.gltf",
  "/models/characters/OldClassy_Female.gltf",
] as const;

export function isSuitModelPath(modelPath: string): boolean {
  return /\/Suit_(Male|Female)\.gltf$/i.test(modelPath);
}

export function coerceAgentModelPath(modelPath: unknown): string {
  if (typeof modelPath !== "string" || modelPath.trim().length === 0) return NON_SUIT_AGENT_MODELS[0];
  return isSuitModelPath(modelPath) ? NON_SUIT_AGENT_MODELS[0] : modelPath;
}

// Mixed palette: brown (South Asian), black (African), white (European), and one extra warm tone.
const SKIN_TONES: Record<AgentRole, string> = {
  manager: "#F1D3B3",
  research: "#8A5A38",
  writer: "#4C2F20",
  finance: "#D7B38A",
  qa: "#F1D3B3",
};

const DESKS: Record<AgentRole, [number, number, number]> = {
  // Seat anchors (in front of desk), not desk center.
  manager: [0, 0.1, -2.28],
  research: [-2.8, 0.1, 0.12],
  writer: [2.8, 0.1, 0.12],
  finance: [-1.6, 0.1, 3.02],
  qa: [1.6, 0.1, 3.02],
};

const IDLE: Record<AgentRole, [number, number, number]> = {
  // Idle/home is the desk seat.
  manager: DESKS.manager,
  research: DESKS.research,
  writer: DESKS.writer,
  finance: DESKS.finance,
  qa: DESKS.qa,
};

const EXTRA_AGENT_POSITIONS: [number, number, number][] = [
  [-4.2, 0.1, -2.2],
  [4.2, 0.1, -2.2],
  [-4.2, 0.1, 1.2],
  [4.2, 0.1, 1.2],
  [-2.2, 0.1, 4.2],
  [2.2, 0.1, 4.2],
  [0, 0.1, 5.4],
  [-5.6, 0.1, 4.4],
  [5.6, 0.1, 4.4],
];

export function getAgentHomePosition(index: number, role?: AgentRole): [number, number, number] {
  if (typeof role === "string" && AGENT_ORDER[index] === role) return IDLE[role];
  const preset = EXTRA_AGENT_POSITIONS[index % EXTRA_AGENT_POSITIONS.length];
  const ring = Math.floor(index / EXTRA_AGENT_POSITIONS.length);
  if (ring === 0) return preset;
  const angle = index * 2.399963229728653;
  const radius = 4 + ring * 1.2;
  return [
    Number((Math.cos(angle) * radius).toFixed(2)),
    0.1,
    Number((Math.sin(angle) * radius + 1.4).toFixed(2)),
  ];
}

export function buildInitialAgents(): AgentState[] {
  return AGENT_ORDER.map((role, idx) => ({
    id: role,
    role,
    label: AGENT_LABELS[role],
    color: COLORS[role],
    skinTone: SKIN_TONES[role],
    eyeColor: "#332211",
    hairColor: "#111111",
    modelPath: MODELS[role],
    status: "idle",
    balance: 2 + idx * 0.34,
    currentTask: null,
    position: IDLE[role],
    idlePosition: IDLE[role],
    deskPosition: DESKS[role],
  }));
}

function cleanPrompt(prompt: string) {
  return prompt.trim().replace(/\s+/g, " ");
}

export function buildTaskSteps(prompt: string): TaskStep[] {
  const text = cleanPrompt(prompt);
  const base = text || "General office task";
  const pipeline: Array<{ role: AgentRole; verb: string }> = [
    { role: "manager", verb: "Route the request" },
    { role: "research", verb: "Extract requirements" },
    { role: "writer", verb: "Plan implementation tasks" },
    { role: "finance", verb: "Generate implementation output" },
    { role: "qa", verb: "Review and validate output" },
  ];
  const total = text.length % 2 === 0 ? 5 : 4;
  return pipeline.slice(0, total).map((entry, idx) => ({
    id: `${Date.now()}-${idx}-${entry.role}`,
    agentId: entry.role,
    role: entry.role,
    text: `${entry.verb} for: ${base}`,
    payment: 0.001 + idx * 0.0004,
  }));
}
