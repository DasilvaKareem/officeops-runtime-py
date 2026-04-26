import { ref as dbRef, get, push, set, update } from "firebase/database";
import { db } from "@/src/lib/firebase";
import { createFolder, uploadUserBlob, type FsNode } from "@/src/lib/filesystem";
import type { AgentState } from "@/src/lib/officeSim";
import type { OrchestratorArtifact } from "@/src/lib/orchestrator/stream";
import type { WorkflowRun } from "@/src/store/useOfficeStore";

export type ElevatorTransferStatus = "queued" | "moving" | "arrived" | "cancelled";

export type RuntimeAgentRecord = {
  id: string;
  label: string;
  role: AgentState["role"];
  color: string;
  status: AgentState["status"];
  currentAction: string | null;
  currentTask: string | null;
  position: AgentState["position"];
  homeFloorId: number;
  currentFloorId: number;
  deskPosition: AgentState["deskPosition"];
  idlePosition: AgentState["idlePosition"];
  modelPath: string;
  updatedAt: number;
  lastRunId: string | null;
  elevatorStatus: ElevatorTransferStatus | "idle";
};

export type RuntimeArtifactRecord = {
  id: string;
  runId: string;
  floorId: number;
  agentId: string | null;
  nodeId: string;
  fileName: string;
  mimeType: string;
  kind: string;
  storagePath?: string;
  downloadURL?: string;
  createdAt: number;
};

export type RuntimeRunRecord = {
  id: string;
  backendRunId?: string;
  floorId: number;
  prompt: string;
  goal: string;
  status: WorkflowRun["status"];
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  totalSteps: number;
  completedSteps: number;
  txCount: number;
  totalSpent: number;
  activeAgentIds: string[];
  artifactIds: string[];
  lastMessage: string | null;
};

export type ElevatorTransferRecord = {
  id: string;
  agentId: string;
  agentLabel: string;
  fromFloorId: number;
  toFloorId: number;
  status: ElevatorTransferStatus;
  reason: string;
  requestedAt: number;
  updatedAt: number;
  completedAt?: number;
  runId?: string;
};

type ArtifactDraft = {
  agentId?: string | null;
  fileName: string;
  content: string;
  mimeType: string;
  kind: "code" | "report" | "json" | "notes" | "html" | "media";
};

function mapArtifactKind(kind: ArtifactDraft["kind"]): "code" | "other" {
  return kind === "html" || kind === "code" ? "code" : "other";
}

function floorPath(userId: string, floorId: number) {
  return `users/${userId}/company/floors/${floorId}`;
}

function companyPath(userId: string) {
  return `users/${userId}/company`;
}

function artifactPath(userId: string, artifactId: string) {
  return `users/${userId}/artifacts/byId/${artifactId}`;
}

function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => removeUndefined(entry)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, removeUndefined(entry)])
    ) as T;
  }
  return value;
}

async function ensureFolderByName(userId: string, parentId: string | null, name: string): Promise<FsNode> {
  const childrenSnap = await get(dbRef(db, `users/${userId}/fs/children/${parentId ?? "__root__"}`));
  if (childrenSnap.exists()) {
    const childIds = Object.keys(childrenSnap.val() as Record<string, true>);
    for (const childId of childIds) {
      const nodeSnap = await get(dbRef(db, `users/${userId}/fs/nodes/${childId}`));
      if (!nodeSnap.exists()) continue;
      const node = nodeSnap.val() as FsNode;
      if (node.type === "folder" && node.name === name) return node;
    }
  }

  return createFolder(userId, parentId, name);
}

export async function syncRuntimeAgentsForFloor(
  userId: string,
  floorId: number,
  agents: AgentState[]
): Promise<void> {
  const now = Date.now();
  const floorAgents: Record<string, RuntimeAgentRecord> = {};
  const companyAgents: Record<string, RuntimeAgentRecord> = {};

  for (const agent of agents) {
    const record: RuntimeAgentRecord = {
      id: agent.id,
      label: agent.label,
      role: agent.role,
      color: agent.color,
      status: agent.status,
      currentAction: "idle",
      currentTask: agent.currentTask ?? null,
      position: agent.position,
      homeFloorId: floorId,
      currentFloorId: floorId,
      deskPosition: agent.deskPosition,
      idlePosition: agent.idlePosition,
      modelPath: agent.modelPath,
      updatedAt: now,
      lastRunId: null,
      elevatorStatus: "idle",
    };
    floorAgents[agent.id] = record;
    companyAgents[agent.id] = record;
  }

  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`floors/${floorId}/runtimeAgents`]: floorAgents,
    [`agentDirectory/floor-${floorId}`]: companyAgents,
    updatedAt: now,
  }));
}

export async function startRuntimeRun(
  userId: string,
  floorId: number,
  run: WorkflowRun
): Promise<void> {
  const record: RuntimeRunRecord = {
    id: run.id,
    backendRunId: run.backendRunId,
    floorId,
    prompt: run.prompt,
    goal: run.goal,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    totalSteps: run.totalSteps,
    completedSteps: run.completedSteps,
    txCount: run.txCount,
    totalSpent: run.totalSpent,
    activeAgentIds: [],
    artifactIds: [],
    lastMessage: run.logs[0]?.text ?? null,
  };

  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`floors/${floorId}/runs/${run.id}`]: record,
    [`runs/${run.id}`]: record,
    updatedAt: Date.now(),
  }));
}

export async function syncRuntimeRun(
  userId: string,
  floorId: number,
  run: WorkflowRun
): Promise<void> {
  const activeAgentIds = Object.entries(run.agentStates)
    .filter(([, snapshot]) => snapshot?.status && snapshot.status !== "idle")
    .map(([agentId]) => agentId);

  const patch: Partial<RuntimeRunRecord> = {
    backendRunId: run.backendRunId ?? undefined,
    status: run.status,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt ?? undefined,
    totalSteps: run.totalSteps,
    completedSteps: run.completedSteps,
    txCount: run.txCount,
    totalSpent: run.totalSpent,
    activeAgentIds,
    lastMessage: run.logs[0]?.text ?? null,
  };

  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`floors/${floorId}/runs/${run.id}`]: patch,
    [`runs/${run.id}`]: patch,
    updatedAt: Date.now(),
  }));
}

export async function syncRuntimeAgentActivity(
  userId: string,
  floorId: number,
  runId: string,
  agent: AgentState,
  currentTask: string | null,
  currentAction: string | null
): Promise<void> {
  const updatedAt = Date.now();
  const patch: Partial<RuntimeAgentRecord> = {
    label: agent.label,
    role: agent.role,
    color: agent.color,
    status: agent.status,
    currentAction,
    currentTask: currentTask ?? null,
    position: agent.position,
    currentFloorId: floorId,
    updatedAt,
    lastRunId: runId,
  };

  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`floors/${floorId}/runtimeAgents/${agent.id}`]: patch,
    [`agentDirectory/floor-${floorId}/${agent.id}`]: patch,
    updatedAt,
  }));
}

export async function queueElevatorTransfer(
  userId: string,
  options: {
    agentId: string;
    agentLabel: string;
    fromFloorId: number;
    toFloorId: number;
    reason: string;
    runId?: string;
  }
): Promise<string> {
  const transferRef = push(dbRef(db, `${companyPath(userId)}/elevator/transfers`));
  const id = transferRef.key;
  if (!id) throw new Error("Failed to allocate elevator transfer id.");

  const now = Date.now();
  const record: ElevatorTransferRecord = {
    id,
    agentId: options.agentId,
    agentLabel: options.agentLabel,
    fromFloorId: options.fromFloorId,
    toFloorId: options.toFloorId,
    status: "queued",
    reason: options.reason,
    requestedAt: now,
    updatedAt: now,
    runId: options.runId,
  };

  await set(transferRef, removeUndefined(record));
  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`agentDirectory/floor-${options.fromFloorId}/${options.agentId}/elevatorStatus`]: "queued",
    [`agentDirectory/floor-${options.fromFloorId}/${options.agentId}/lastRunId`]: options.runId ?? null,
    updatedAt: now,
  }));

  return id;
}

export async function completeElevatorTransfer(
  userId: string,
  transferId: string,
  options: {
    agentId: string;
    fromFloorId: number;
    toFloorId: number;
  }
): Promise<void> {
  const now = Date.now();
  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`elevator/transfers/${transferId}/status`]: "arrived",
    [`elevator/transfers/${transferId}/updatedAt`]: now,
    [`elevator/transfers/${transferId}/completedAt`]: now,
    [`agentDirectory/floor-${options.fromFloorId}/${options.agentId}/currentFloorId`]: options.toFloorId,
    [`agentDirectory/floor-${options.fromFloorId}/${options.agentId}/elevatorStatus`]: "arrived",
    updatedAt: now,
  }));
}

export async function dispatchAgentToFloor(
  userId: string,
  agent: AgentState,
  fromFloorId: number,
  toFloorId: number,
  reason: string,
  runId?: string
): Promise<string> {
  const transferId = await queueElevatorTransfer(userId, {
    agentId: agent.id,
    agentLabel: agent.label,
    fromFloorId,
    toFloorId,
    reason,
    runId,
  });

  const now = Date.now();
  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`elevator/transfers/${transferId}/status`]: "moving",
    [`elevator/transfers/${transferId}/updatedAt`]: now,
    [`floors/${fromFloorId}/runtimeAgents/${agent.id}/elevatorStatus`]: "moving",
    [`agentDirectory/floor-${fromFloorId}/${agent.id}/elevatorStatus`]: "moving",
    updatedAt: now,
  }));

  const fromAgentsRef = dbRef(db, `${floorPath(userId, fromFloorId)}/agents`);
  const toAgentsRef = dbRef(db, `${floorPath(userId, toFloorId)}/agents`);
  const [fromSnap, toSnap] = await Promise.all([get(fromAgentsRef), get(toAgentsRef)]);
  const fromAgents = fromSnap.exists() ? ((fromSnap.val() as AgentState[]) ?? []) : [];
  const toAgents = toSnap.exists() ? ((toSnap.val() as AgentState[]) ?? []) : [];

  const nextFromAgents = fromAgents.filter((candidate) => candidate.id !== agent.id);
  const nextToAgents = [...toAgents.filter((candidate) => candidate.id !== agent.id), agent];

  await Promise.all([
    set(fromAgentsRef, nextFromAgents),
    set(toAgentsRef, nextToAgents),
    update(dbRef(db, companyPath(userId)), {
      [`floors/${fromFloorId}/runtimeAgents/${agent.id}`]: null,
      [`floors/${toFloorId}/runtimeAgents/${agent.id}`]: {
        id: agent.id,
        label: agent.label,
        role: agent.role,
        color: agent.color,
        status: agent.status,
        currentAction: "arrived",
        currentTask: agent.currentTask ?? null,
        position: agent.position,
        homeFloorId: fromFloorId,
        currentFloorId: toFloorId,
        deskPosition: agent.deskPosition,
        idlePosition: agent.idlePosition,
        modelPath: agent.modelPath,
        updatedAt: now,
        lastRunId: runId ?? null,
        elevatorStatus: "arrived",
      } satisfies RuntimeAgentRecord,
      [`agentDirectory/floor-${fromFloorId}/${agent.id}`]: null,
      [`agentDirectory/floor-${toFloorId}/${agent.id}`]: {
        id: agent.id,
        label: agent.label,
        role: agent.role,
        color: agent.color,
        status: agent.status,
        currentAction: "arrived",
        currentTask: agent.currentTask ?? null,
        position: agent.position,
        homeFloorId: fromFloorId,
        currentFloorId: toFloorId,
        deskPosition: agent.deskPosition,
        idlePosition: agent.idlePosition,
        modelPath: agent.modelPath,
        updatedAt: now,
        lastRunId: runId ?? null,
        elevatorStatus: "arrived",
      } satisfies RuntimeAgentRecord,
      updatedAt: now,
    }),
  ]);

  await completeElevatorTransfer(userId, transferId, {
    agentId: agent.id,
    fromFloorId,
    toFloorId,
  });

  return transferId;
}

function buildArtifactsForRun(run: WorkflowRun): ArtifactDraft[] {
  const logsNewestFirst = [...run.logs];
  const logsOldestFirst = logsNewestFirst.slice().reverse();
  const transcript = logsOldestFirst.map((log) => `- [${new Date(log.at).toISOString()}] ${log.text}`).join("\n");
  const artifactDrafts: ArtifactDraft[] = [
    {
      fileName: "run-summary.md",
      mimeType: "text/markdown",
      kind: "report",
      content: [
        `# Run Summary`,
        ``,
        `Prompt: ${run.prompt}`,
        `Status: ${run.status}`,
        `Completed Steps: ${run.completedSteps}/${run.totalSteps}`,
        `Spend: ${run.totalSpent}`,
        ``,
        `## Activity`,
        transcript || "- No events captured.",
      ].join("\n"),
    },
    {
      fileName: "run.json",
      mimeType: "application/json",
      kind: "json",
      content: JSON.stringify(
        {
          id: run.id,
          backendRunId: run.backendRunId,
          goal: run.goal,
          prompt: run.prompt,
          status: run.status,
          totalSteps: run.totalSteps,
          completedSteps: run.completedSteps,
          txCount: run.txCount,
          totalSpent: run.totalSpent,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          logs: run.logs,
        },
        null,
        2
      ),
    },
  ];

  const normalizedPrompt = run.prompt.toLowerCase();

  if (/(website|web page|webpage|html|landing page|site)/.test(normalizedPrompt)) {
    artifactDrafts.push(
      {
        fileName: "index.html",
        mimeType: "text/html",
        kind: "html",
        agentId: "finance",
        content: [
          "<!DOCTYPE html>",
          "<html lang=\"en\">",
          "<head>",
          "  <meta charset=\"UTF-8\" />",
          "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
          `  <title>${escapeHtml(run.goal)}</title>`,
          "  <link rel=\"stylesheet\" href=\"styles.css\" />",
          "</head>",
          "<body>",
          "  <main class=\"shell\">",
          `    <h1>${escapeHtml(run.goal)}</h1>`,
          `    <p class=\"lede\">Generated from the run prompt: ${escapeHtml(run.prompt)}</p>`,
          "    <section>",
          "      <h2>Workflow Notes</h2>",
          "      <pre>",
          escapeHtml(logsOldestFirst.map((log) => log.text).join("\n") || "No workflow notes captured."),
          "      </pre>",
          "    </section>",
          "  </main>",
          "</body>",
          "</html>",
        ].join("\n"),
      },
      {
        fileName: "styles.css",
        mimeType: "text/css",
        kind: "code",
        agentId: "finance",
        content: [
          ":root { color-scheme: dark; }",
          "body { margin: 0; font-family: 'IBM Plex Sans', sans-serif; background: linear-gradient(180deg, #09111f 0%, #101b2f 100%); color: #f8fafc; }",
          ".shell { max-width: 960px; margin: 0 auto; padding: 72px 24px; }",
          ".lede { color: #93c5fd; font-size: 1.1rem; }",
          "section { margin-top: 32px; padding: 20px; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; background: rgba(15, 23, 42, 0.8); }",
          "pre { white-space: pre-wrap; font-family: 'IBM Plex Mono', monospace; color: #cbd5e1; }",
        ].join("\n"),
      }
    );
  }

  if (/(book|read|summary|summarize|notes|research)/.test(normalizedPrompt)) {
    artifactDrafts.push({
      fileName: "reading-notes.md",
      mimeType: "text/markdown",
      kind: "notes",
      agentId: "research",
      content: [
        `# Reading Notes`,
        ``,
        `Prompt: ${run.prompt}`,
        ``,
        `## Extracted Notes`,
        ...logsOldestFirst.map((log) => `- ${log.text}`),
      ].join("\n"),
    });
  }

  return artifactDrafts;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function persistRunArtifacts(
  userId: string,
  floorId: number,
  run: WorkflowRun,
  streamedArtifacts?: OrchestratorArtifact[]
): Promise<RuntimeArtifactRecord[]> {
  const outputsRoot = await ensureFolderByName(userId, null, "Agent Outputs");
  const floorFolder = await ensureFolderByName(userId, outputsRoot.id, `Floor ${floorId}`);
  const runFolder = await ensureFolderByName(userId, floorFolder.id, `Run ${run.id}`);
  const drafts = streamedArtifacts && streamedArtifacts.length > 0
    ? streamedArtifacts.map((artifact) => ({
        agentId: artifact.agentName ? resolveArtifactAgentId(artifact.agentName) : null,
        fileName: artifact.fileName,
        content: artifact.content,
        mimeType: artifact.mimeType,
        kind: artifact.kind,
      }))
    : buildArtifactsForRun(run);
  const now = Date.now();
  const records: RuntimeArtifactRecord[] = [];

  for (const draft of drafts) {
    const node = await uploadUserBlob(
      userId,
      runFolder.id,
      draft.fileName,
      new Blob([draft.content], { type: draft.mimeType }),
      mapArtifactKind(draft.kind)
    );

    const record: RuntimeArtifactRecord = {
      id: node.id,
      runId: run.id,
      floorId,
      agentId: draft.agentId ?? null,
      nodeId: node.id,
      fileName: node.name,
      mimeType: node.mimeType || draft.mimeType,
      kind: draft.kind,
      storagePath: node.storagePath,
      downloadURL: node.downloadURL,
      createdAt: now,
    };

    records.push(record);

    await update(dbRef(db, companyPath(userId)), removeUndefined({
      [`artifacts/byRun/${run.id}/${record.id}`]: record,
      ...(record.agentId ? { [`artifacts/byAgent/${record.agentId}/${record.id}`]: record } : {}),
    }));
    await set(dbRef(db, artifactPath(userId, record.id)), removeUndefined(record));
  }

  await update(dbRef(db, companyPath(userId)), removeUndefined({
    [`floors/${floorId}/runs/${run.id}/artifactIds`]: records.map((record) => record.id),
    [`runs/${run.id}/artifactIds`]: records.map((record) => record.id),
    updatedAt: now,
  }));

  return records;
}

function resolveArtifactAgentId(agentName: string): string | null {
  const lower = agentName.toLowerCase();
  if (lower.includes("requirement")) return "research";
  if (lower.includes("task")) return "writer";
  if (lower.includes("developer")) return "finance";
  if (lower.includes("review")) return "qa";
  if (lower.includes("router") || lower.includes("manager")) return "manager";
  return null;
}
