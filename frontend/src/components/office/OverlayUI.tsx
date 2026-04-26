"use client";

import { useMemo, useState } from "react";
import { formatUsdc, useOfficeStore, useProgressPercent } from "@/src/store/useOfficeStore";
import { FileExplorer } from "@/src/components/office/FileExplorer";
import { HireAgentModal } from "@/src/components/office/HireAgentModal";
import type { AgentState } from "@/src/lib/officeSim";

function toneClass(tone: "info" | "success" | "warning") {
  if (tone === "success") return "text-emerald-300";
  if (tone === "warning") return "text-amber-300";
  return "text-slate-200";
}

const ELEVATOR_FLOORS = [
  { id: 7, name: "Executive Floor" },
  { id: 6, name: "Sales" },
  { id: 5, name: "Marketing" },
  { id: 4, name: "Engineering" },
  { id: 3, name: "Administration" },
  { id: 2, name: "Human Resources" },
  { id: 1, name: "Lobby" },
];

export function OverlayUI({ onClose }: { onClose?: () => void }) {
  const {
    agents,
    baseAgents,
    prompt,
    activeRunId,
    runs,
    editMode,
    selectedFloor,
    setPrompt,
    selectRun,
    runWorkflow,
    stopRun,
    setEditMode,
    userProfile,
  } = useOfficeStore();
  const progress = useProgressPercent();
  const currentRun = useMemo(
    () => runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null,
    [runs, activeRunId]
  );
  const running = useMemo(
    () => runs.some((run) => run.status === "running"),
    [runs]
  );
  const activeRuns = useMemo(
    () => runs.filter((run) => run.status === "running"),
    [runs]
  );

  const activeAgents = useMemo(
    () => agents.filter((a) => a.status !== "idle").length,
    [agents]
  );
  const hasAgents = baseAgents.length > 0;
  
  const [showHireModal, setShowHireModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentState | null>(null);
  const currentFloorName = ELEVATOR_FLOORS.find(f => f.id === selectedFloor)?.name || "Unknown Floor";
  const sidebarAgents = useMemo(
    () => [...baseAgents].sort((left, right) => left.label.localeCompare(right.label)),
    [baseAgents]
  );

  return (
    <>
    <div className="pointer-events-none absolute inset-0 z-40 bg-slate-950/20 text-white backdrop-blur-[1px]">
      <div className="pointer-events-auto absolute left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-emerald-400/30 bg-slate-950/90 px-4 py-2 shadow-2xl shadow-emerald-950/30">
        <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] font-black tracking-[0.22em] text-emerald-200">
          M
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">Master Command</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="grid h-full grid-cols-[230px_1fr_300px] gap-4 p-4 pt-16">
      <aside className="pointer-events-auto flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/85 p-3">
        <div className="mb-3">
          <h1 className="text-3xl font-semibold leading-none">OfficeOps</h1>
          <p className="text-sm text-slate-400 mt-1">
             FL {selectedFloor}: {currentFloorName}
          </p>
        </div>

        <div className="flex gap-2 mb-2">
          <button
            onClick={() => {
              onClose?.();
              useOfficeStore.getState().setViewMode("building");
            }}
            className="flex-1 rounded-lg border border-white/10 bg-slate-900/80 px-2 py-2 text-[11px] font-medium text-slate-300 transition-all hover:bg-slate-800"
          >
            ← Building
          </button>
          
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition-all ${
              editMode
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-white/10 bg-slate-900/80 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {editMode ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Done
              </>
            ) : (
              "Edit"
            )}
          </button>
        </div>

        <button
          onClick={() => setShowHireModal(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 transition-all"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Hire Agent
        </button>

        <div className="flex-1 space-y-2 overflow-y-auto pr-1 mt-2">
          {sidebarAgents.map((agent) => {
            const runtimeAgent = agents.find((candidate) => candidate.id === agent.id) ?? agent;
            const statusColor =
              runtimeAgent.status === "working"
                ? "text-amber-300"
                : runtimeAgent.status === "idle"
                  ? "text-slate-400"
                  : "text-emerald-300";
            return (
              <div key={agent.id} className="rounded-lg border border-white/10 bg-slate-900/80 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{agent.label}</p>
                  <span
                    className="h-3 w-3 rounded-full border border-white/30"
                    style={{ backgroundColor: agent.color }}
                  />
                </div>
                <p className="text-xs text-slate-500">{agent.role}</p>
                <p className={`text-xs ${statusColor}`}>{runtimeAgent.status}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">Balance {formatUsdc(runtimeAgent.balance)}</p>
                  <button
                    onClick={() => setEditingAgent(agent)}
                    className="rounded-md border border-white/10 bg-slate-950/80 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white"
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <main className="relative flex min-h-0 flex-col gap-3">
        <div className="pointer-events-auto grid grid-cols-4 gap-2 rounded-xl border border-white/10 bg-slate-950/75 p-2 xl:grid-cols-6">
          <div className="col-span-2 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">Current Goal</p>
            <p className="mt-1 truncate text-sm text-white">{currentRun?.goal ?? "No active goal"}</p>
            {activeRuns.length > 0 ? (
              <p className="mt-0.5 text-[11px] text-amber-300">
                {activeRuns.length} live run{activeRuns.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          <div className="col-span-2 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Progress</p>
            <div className="mt-2 h-2 rounded-full bg-slate-950">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-300">{progress}%</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Tasks</p>
            <p className="mt-1 text-xl font-semibold">
              {currentRun?.completedSteps ?? 0}/{currentRun?.totalSteps || "-"}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Runs</p>
            <p className="mt-1 text-xl font-semibold">{activeRuns.length}</p>
            <p className="text-[10px] text-slate-500">{runs.length} total</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Agents</p>
            <p className="mt-1 text-xl font-semibold">{activeAgents}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Run TX</p>
            <p className="mt-1 text-xl font-semibold">{currentRun?.txCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Spent</p>
            <p className="mt-1 truncate text-xl font-semibold">{formatUsdc(currentRun?.totalSpent ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 flex flex-col justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">CEO Wallet</p>
            <p className="mt-1 truncate text-lg font-mono font-semibold text-emerald-100">
              {userProfile?.walletAddress ? `${userProfile.walletAddress.slice(0, 6)}...${userProfile.walletAddress.slice(-4)}` : "No Wallet"}
            </p>
            <p className="text-[10px] font-medium text-emerald-400/70 mt-0.5">
              Balance: {formatUsdc(Math.max(0, 12.452 - (currentRun?.totalSpent ?? 0)))}
            </p>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-[48px_0_76px_0]" />

        {currentRun?.assistantMessage ? (
          <div className="pointer-events-auto rounded-2xl border border-emerald-400/25 bg-slate-950/85 p-4 shadow-2xl shadow-emerald-950/20">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-200">Agent Response</p>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{currentRun.assistantMessage}</p>
          </div>
        ) : null}

        <div className="pointer-events-auto mt-auto flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !running && hasAgents) {
                void runWorkflow();
              }
            }}
            placeholder="What would you like your team to work on?"
            className="h-11 flex-1 rounded-lg border border-white/15 bg-slate-900/70 px-3 text-sm outline-none ring-0 focus:border-emerald-500"
          />
          <button
            disabled={running || !hasAgents}
            onClick={() => void runWorkflow()}
            className="h-11 min-w-28 rounded-lg bg-emerald-600 px-5 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Running" : hasAgents ? "Run" : "Hire Agent"}
          </button>
        </div>
        {!hasAgents ? (
          <p className="pointer-events-auto text-xs text-amber-300">
            Hire at least one agent to start a run.
          </p>
        ) : null}

        {runs.length > 0 ? (
          <div className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">Runs</p>
              <p className="text-xs text-slate-400">{runs.length} tracked</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {runs.map((run) => {
                const isSelected = run.id === currentRun?.id;
                const borderClass =
                  run.status === "running"
                    ? "border-emerald-500/40"
                    : run.status === "error"
                      ? "border-rose-500/40"
                      : run.status === "cancelled"
                        ? "border-amber-500/40"
                      : "border-white/10";
                const toneClass =
                  run.status === "running"
                    ? "text-emerald-300"
                    : run.status === "error"
                      ? "text-rose-300"
                      : run.status === "cancelled"
                        ? "text-amber-300"
                      : "text-slate-300";

                return (
                  <div
                    key={run.id}
                    className={`rounded-lg border bg-slate-900/80 p-3 transition hover:bg-slate-900 ${borderClass} ${
                      isSelected ? "ring-1 ring-emerald-400/50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => selectRun(run.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-white">{run.goal}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {run.completedSteps}/{run.totalSteps || "-"} steps
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {new Date(run.startedAt).toLocaleTimeString()}
                        </p>
                      </button>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`text-xs font-medium uppercase ${toneClass}`}>{run.status}</span>
                        {run.status === "running" ? (
                          <button
                            onClick={() => stopRun(run.id)}
                            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/20"
                          >
                            Stop
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {currentRun?.successMessage ? (
          <div className="pointer-events-auto rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {currentRun.successMessage}
          </div>
        ) : null}
      </main>

      <aside className="pointer-events-auto flex min-h-0 flex-col gap-3">
        <FileExplorer />
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-slate-950/85 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">Selected Run Stream</p>
            <p className="text-xs text-slate-400">{currentRun?.txCount ?? 0} tx</p>
          </div>
          <div className="space-y-1 overflow-y-auto pr-1">
            {(currentRun?.logs ?? []).map((log) => (
              <div key={log.id} className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1.5">
                <p className={`text-xs ${toneClass(log.tone)}`}>{log.text}</p>
                {typeof log.amount === "number" ? (
                  <p className="text-xs text-emerald-400">+{formatUsdc(log.amount)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </aside>
      
      {showHireModal ? <HireAgentModal key="create-agent" onClose={() => setShowHireModal(false)} /> : null}
      {editingAgent ? (
        <HireAgentModal
          key={editingAgent.id}
          existingAgent={editingAgent}
          onClose={() => setEditingAgent(null)}
        />
      ) : null}
      </div>
    </div>
    </>
  );
}
