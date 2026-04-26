export type OrchestratorEvent =
  | { kind: "workflow_started"; runId?: string; totalSteps?: number; text?: string }
  | { kind: "agent_started"; runId?: string; agent?: string; text?: string; stepId?: string }
  | { kind: "agent_stream"; runId?: string; agent?: string; text?: string }
  | { kind: "agent_completed"; runId?: string; agent?: string; text?: string; stepId?: string; amount?: number; toAgent?: string }
  | { kind: "agent_failed"; runId?: string; agent?: string; text?: string; stepId?: string; error?: string }
  | { kind: "payment"; runId?: string; fromAgent?: string; toAgent?: string; amount?: number; taskId?: string; txHash?: string; status?: string }
  | { kind: "workflow_completed"; runId?: string; text?: string; artifacts?: OrchestratorArtifact[] }
  | { kind: "workflow_failed"; runId?: string; text: string }
  | { kind: "message"; runId?: string; text: string };

export type OrchestratorArtifact = {
  fileName: string;
  mimeType: string;
  content: string;
  kind: "code" | "report" | "json" | "notes" | "html" | "media";
  agentName?: string;
  stage?: string;
};

export type StreamArgs = {
  prompt: string;
  userId?: string;
  floorId?: number;
  endpoint?: string;
  signal?: AbortSignal;
  onEvent: (event: OrchestratorEvent) => void;
};

const DEFAULT_ENDPOINT = "/api/orchestrate";

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseMaybeJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function normalizeEvent(payload: unknown): OrchestratorEvent | null {
  if (typeof payload === "string") {
    const text = payload.trim();
    if (!text) return null;
    if (text === "[DONE]") return { kind: "workflow_completed", text: "Done." };
    return { kind: "message", text };
  }
  if (!payload || typeof payload !== "object") return null;

  const obj = payload as Record<string, unknown>;
  const typeRaw = String(obj.event ?? obj.type ?? obj.kind ?? "").toLowerCase();
  const runId = typeof obj.runId === "string" ? obj.runId : undefined;
  const text = typeof obj.message === "string"
    ? obj.message
    : typeof obj.text === "string"
      ? obj.text
      : typeof obj.content === "string"
        ? obj.content
        : undefined;
  const agent = typeof obj.agent === "string"
    ? obj.agent
    : typeof obj.agentName === "string"
      ? obj.agentName
      : typeof obj.fromAgent === "string"
        ? obj.fromAgent
        : undefined;
  const toAgent = typeof obj.toAgent === "string" ? obj.toAgent : undefined;
  const stepId = typeof obj.stepId === "string" ? obj.stepId : undefined;
  const amount = toNumber(obj.amount ?? obj.payment);
  const token = typeof obj.token === "string" ? obj.token : undefined;
  const compactText = text && text.length > 220 ? `${text.slice(0, 220)}...` : text;
  const artifacts = Array.isArray(obj.artifacts)
    ? obj.artifacts
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          fileName: typeof item.fileName === "string"
            ? item.fileName
            : typeof item.file_name === "string"
              ? item.file_name
              : "artifact.txt",
          mimeType: typeof item.mimeType === "string"
            ? item.mimeType
            : typeof item.mime_type === "string"
              ? item.mime_type
              : "text/plain",
          content: typeof item.content === "string" ? item.content : "",
          kind: (typeof item.kind === "string" ? item.kind : "report") as OrchestratorArtifact["kind"],
          agentName: typeof item.agentName === "string"
            ? item.agentName
            : typeof item.agent_name === "string"
              ? item.agent_name
              : undefined,
          stage: typeof item.stage === "string" ? item.stage : undefined,
        }))
    : undefined;

  if (typeRaw.includes("workflow_start") || typeRaw.includes("orchestrat") || typeRaw.includes("pipeline_start")) {
    return { kind: "workflow_started", runId, totalSteps: toNumber(obj.totalSteps), text: compactText };
  }
  if (typeRaw.includes("workflow_complete") || typeRaw.includes("pipeline_complete") || typeRaw.includes("final_result") || typeRaw.includes("done")) {
    return { kind: "workflow_completed", runId, text: compactText ?? "Workflow complete.", artifacts };
  }
  if (typeRaw.includes("stage_start")) {
    return { kind: "agent_started", runId, agent, text: compactText, stepId };
  }
  if (typeRaw.includes("stage_token")) {
    // Tokens can be emitted character-by-character; only bubble meaningful chunks.
    if (!token) return null;
    if (!(token.length > 16 || /[\n.!?]/.test(token))) return null;
    return { kind: "agent_stream", runId, agent, text: token.length > 120 ? `${token.slice(0, 120)}...` : token };
  }
  if (typeRaw.includes("stage_complete")) {
    return { kind: "agent_completed", runId, agent, text: compactText, stepId, amount, toAgent };
  }
  if (typeRaw.includes("stage_error")) {
    const errorText = typeof obj.error === "string" ? obj.error : undefined;
    return { kind: "agent_failed", runId, agent, text: compactText ?? errorText, stepId, error: errorText };
  }
  if (typeRaw.includes("agent_start") || typeRaw.includes("task_start") || typeRaw.includes("step_start")) {
    return { kind: "agent_started", runId, agent, text: compactText, stepId };
  }
  if (typeRaw.includes("agent_complete") || typeRaw.includes("task_complete") || typeRaw.includes("step_complete")) {
    return { kind: "agent_completed", runId, agent, text: compactText, stepId, amount, toAgent };
  }
  if (typeRaw.includes("pipeline_blocked")) {
    const errorText = typeof obj.error === "string" ? obj.error : compactText ?? "Workflow blocked.";
    return { kind: "workflow_failed", runId, text: errorText };
  }
  if (typeRaw.includes("payment") || obj.txHash || obj.fromAgent || obj.toAgent) {
    return {
      kind: "payment",
      runId,
      fromAgent: typeof obj.fromAgent === "string" ? obj.fromAgent : agent,
      toAgent,
      amount,
      taskId: typeof obj.taskId === "string" ? obj.taskId : undefined,
      txHash: typeof obj.txHash === "string" ? obj.txHash : undefined,
      status: typeof obj.status === "string" ? obj.status : undefined,
    };
  }

  if (compactText) return { kind: "message", runId, text: compactText };
  return null;
}

function parseSseChunk(chunk: string, emit: (event: OrchestratorEvent) => void) {
  const blocks = chunk.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      dataLines.push(line.slice(5).trimStart());
    }
    const dataValue = dataLines.join("\n");
    if (!dataValue) continue;
    const parsed = parseMaybeJson(dataValue);
    const normalized = normalizeEvent(parsed);
    if (normalized) emit(normalized);
  }
}

export async function runOrchestratorStream(args: StreamArgs): Promise<void> {
  const endpoint = args.endpoint ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? DEFAULT_ENDPOINT;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
    body: JSON.stringify({
      requirement: args.prompt,
      prompt: args.prompt,
      userId: args.userId,
      floorId: args.floorId,
    }),
    signal: args.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Orchestrator request failed (${response.status}): ${body || response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json().catch(async () => ({ message: await response.text() }));
    const normalized = normalizeEvent(payload);
    if (normalized) args.onEvent(normalized);
    args.onEvent({ kind: "workflow_completed", text: "Completed." });
    return;
  }

  if (!response.body) throw new Error("Orchestrator stream body missing.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      parseSseChunk(part, args.onEvent);
    }
  }

  if (buffer.trim()) parseSseChunk(buffer, args.onEvent);
}
