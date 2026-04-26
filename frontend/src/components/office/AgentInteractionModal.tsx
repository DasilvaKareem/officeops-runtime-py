"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useOfficeStore } from "@/src/store/useOfficeStore";
import { auth } from "@/src/lib/firebase";
import { Html } from "@react-three/drei";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  sender: "ceo" | "agent";
  text: string;
  timestamp: number;
};

function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const role = item.role === "user" ? "user" : "assistant";
      const timestamp = Number(item.created_at ?? item.createdAt ?? Date.now());
      const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
      const text = typeof item.text === "string" ? item.text : "";
      if (!text.trim()) return null;
      return {
        id: typeof item.id === "string" ? item.id : `msg-${safeTimestamp}-${index}`,
        role,
        sender: role === "user" ? "ceo" : "agent",
        text,
        timestamp: safeTimestamp,
      } satisfies ChatMessage;
    })
    .filter((value): value is ChatMessage => Boolean(value))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function AgentInteractionModal() {
  const { 
    interactingAgentId, 
    agents, 
    setInteractingAgentId, 
    baseAgents, 
    isRecording 
  } = useOfficeStore();
  
  const agent = useMemo(() => agents.find(a => a.id === interactingAgentId), [agents, interactingAgentId]);
  const baseAgent = useMemo(() => baseAgents.find(a => a.id === interactingAgentId), [baseAgents, interactingAgentId]);

  const [isChatting, setIsChatting] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  
  // Voice Recording refs
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const loadConversation = useCallback(async () => {
    if (!interactingAgentId || !auth.currentUser) return;
    setIsLoadingMessages(true);
    setChatError(null);
    try {
      const userId = auth.currentUser.uid;
      const response = await fetch(
        `/api/agents/${encodeURIComponent(interactingAgentId)}/conversation?user_id=${encodeURIComponent(userId)}&limit=50`,
        { method: "GET" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof payload?.detail === "string" ? payload.detail : "Failed to load conversation";
        throw new Error(detail);
      }
      setChatMessages(normalizeMessages(payload.messages));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to load conversation";
      setChatError(detail);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [interactingAgentId]);

  useEffect(() => {
    setMessage("");
    setChatMessages([]);
    setChatError(null);
    setIsChatting(false);
  }, [interactingAgentId]);

  // 2. Handle "Press E again to chat"
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E") {
        if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
          setIsChatting(true);
          void loadConversation();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loadConversation]);

  // 3. Handle Push to Talk (R Key) Logic
  useEffect(() => {
    if (!isRecording) {
      if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
        mediaRecorder.current.stop();
      }
      return;
    }

    const startRecording = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder.current = new MediaRecorder(stream);
        audioChunks.current = [];

        mediaRecorder.current.ondataavailable = (event) => {
          audioChunks.current.push(event.data);
        };

        mediaRecorder.current.onstop = async () => {
          const simulatedTranscription = "Proceed with the current project roadmap.";
          setIsChatting(true);
          await handleSendMessage(simulatedTranscription);
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.current.start();
      } catch (err) {
        console.error("Microphone access denied:", err);
      }
    };

    void startRecording();
  }, [isRecording]);

  const handleSendMessage = async (textOverride?: string) => {
    const textToSend = textOverride || message;
    if (!textToSend.trim() || !auth.currentUser || !interactingAgentId || isSendingMessage) return;
    setIsSendingMessage(true);
    setChatError(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(interactingAgentId)}/conversation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          message: textToSend.trim(),
          max_history: 50,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof payload?.detail === "string" ? payload.detail : "Failed to send message";
        throw new Error(detail);
      }
      setChatMessages(normalizeMessages(payload.messages));
      if (!textOverride) setMessage("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to send message";
      setChatError(detail);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleClearChat = async () => {
    if (!interactingAgentId || !auth.currentUser || isLoadingMessages) return;
    if (!confirm("Are you sure you want to clear this conversation?")) return;

    setIsLoadingMessages(true);
    try {
      const userId = auth.currentUser.uid;
      const response = await fetch(
        `/api/agents/${encodeURIComponent(interactingAgentId)}/conversation?user_id=${encodeURIComponent(userId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error("Failed to clear conversation");
      }
      setChatMessages([]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to clear conversation");
    } finally {
      setIsLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (!isChatting) return;
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, isChatting]);

  const clampPosition = (x: number, y: number) => {
    if (typeof window === "undefined") return { x, y };
    const margin = 12;
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? Math.min(window.innerWidth - 24, 1080);
    const fallbackHeight = isMinimized ? 90 : Math.min(window.innerHeight * 0.7, 580);
    const height = rect?.height ?? fallbackHeight;
    return {
      x: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin)),
      y: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - height - margin)),
    };
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (panelPosition !== null) return;
    const panelWidth = Math.min(window.innerWidth - 24, 1080);
    const panelHeight = Math.min(window.innerHeight * 0.7, 580);
    const initial = clampPosition((window.innerWidth - panelWidth) / 2, window.innerHeight - panelHeight - 16);
    setPanelPosition(initial);
  }, [panelPosition, isMinimized]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setPanelPosition((prev) => {
        if (!prev) return prev;
        return clampPosition(prev.x, prev.y);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMinimized]);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    const current = panelPosition ?? { x: 12, y: 12 };
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: current.x,
      originY: current.y,
    };
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const next = clampPosition(
      drag.originX + (e.clientX - drag.startX),
      drag.originY + (e.clientY - drag.startY)
    );
    setPanelPosition(next);
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  if (!agent || !baseAgent) return null;

  return (
    <Html fullscreen className="pointer-events-none">
      <div className="pointer-events-none absolute inset-0 p-3 md:p-4">
        <div
          ref={panelRef}
          className="pointer-events-auto absolute w-[min(1080px,calc(100vw-24px))] md:w-[min(1080px,calc(100vw-32px))]"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          style={
            panelPosition
              ? { left: panelPosition.x, top: panelPosition.y }
              : { left: "50%", bottom: 16, transform: "translateX(-50%)" }
          }
        >
          <div className="max-h-[min(70vh,580px)] overflow-hidden rounded-2xl border border-white/20 bg-slate-950/88 shadow-2xl backdrop-blur-xl">
            <div
              className="flex cursor-move items-center justify-between border-b border-white/10 bg-black/35 px-3 py-2 select-none"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.color }} />
                <span className="text-xs font-black uppercase tracking-widest text-slate-200">Agent Comms</span>
                <span className="text-xs text-slate-400">{agent.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsMinimized((prev) => !prev)}
                  className="rounded-md border border-white/15 bg-slate-900/70 px-2 py-1 text-[10px] font-bold uppercase text-slate-200 transition hover:bg-slate-800"
                >
                  {isMinimized ? "Expand" : "Minimize"}
                </button>
                <button
                  onClick={() => setInteractingAgentId(null)}
                  className="rounded-md border border-white/15 bg-slate-900/70 px-2 py-1 text-[10px] font-bold uppercase text-slate-200 transition hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>

            {isMinimized ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-300">{agent.currentTask || "Idle"}</p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    {agent.status} • {agent.balance.toFixed(3)} USDC
                  </p>
                </div>
                <button
                  onClick={() => setIsChatting((prev) => !prev)}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase transition ${isChatting ? "bg-emerald-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}
                >
                  {isChatting ? "Chat On" : "Open Chat"}
                </button>
              </div>
            ) : (
              <div className="grid gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
                <div className="border-b border-white/10 p-4 md:border-b-0 md:border-r">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.color }} />
                    <h2 className="truncate text-sm font-black uppercase tracking-tighter text-white italic">{agent.label}</h2>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</label>
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${agent.status === "working" ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`} />
                        <span className="text-sm font-semibold capitalize text-white">{agent.status}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">Task</label>
                      <p className="truncate text-sm italic text-slate-300">"{agent.currentTask || "Idle"}"</p>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/10 pt-2">
                      <span className="text-xs text-slate-400">Balance</span>
                      <span className="text-sm font-black text-emerald-400">{agent.balance.toFixed(3)} USDC</span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      onClick={() => {
                        const next = !isChatting;
                        setIsChatting(next);
                        if (next) void loadConversation();
                      }}
                      className={`w-full rounded-lg py-2 text-xs font-black uppercase transition ${isChatting ? "bg-emerald-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}
                    >
                      {isChatting ? "Close Chat" : "Open Chat (E)"}
                    </button>
                    {isChatting && (
                      <button
                        onClick={handleClearChat}
                        className="w-full rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-xs font-bold uppercase text-red-200 transition hover:bg-red-500/20"
                      >
                        Clear Chat
                      </button>
                    )}
                    <button
                      onClick={() => setInteractingAgentId(null)}
                      className="w-full rounded-lg border border-white/15 bg-slate-900/70 py-2 text-xs font-bold uppercase text-slate-200 transition hover:bg-slate-800"
                    >
                      Exit Interaction (Q)
                    </button>
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold uppercase text-slate-500">Hold R to Speak</span>
                      <span className={`text-[10px] font-bold uppercase ${isRecording ? "text-emerald-400" : "text-slate-500"}`}>
                        {isRecording ? "Recording..." : "Mic Ready"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-[320px] flex-col">
                  {isChatting ? (
                    <>
                      <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                        {isLoadingMessages ? (
                          <div className="flex h-full items-center justify-center px-8 text-center text-xs uppercase tracking-widest text-slate-500 italic">
                            Loading conversation...
                          </div>
                        ) : chatMessages.length === 0 ? (
                          <div className="flex h-full items-center justify-center px-8 text-center text-xs uppercase tracking-widest text-slate-500 italic">
                            Secure link established...
                          </div>
                        ) : (
                          chatMessages.map((msg) => (
                            <div key={msg.id} className={`flex flex-col ${msg.sender === "ceo" ? "items-end" : "items-start"}`}>
                              <div
                                className={`max-w-[88%] rounded-xl px-3 py-2 text-sm shadow-lg ${
                                  msg.sender === "ceo"
                                    ? "rounded-tr-none bg-emerald-600 text-white"
                                    : "rounded-tl-none border border-white/10 bg-slate-800 text-slate-200"
                                }`}
                              >
                                <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                                  <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
                                </div>
                              </div>
                              <span className="mt-0.5 px-1 text-[10px] font-bold uppercase text-slate-500 opacity-60">
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          ))
                        )}
                        {chatError && (
                          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                            {chatError}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-white/10 bg-black/40 p-3">
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleSendMessage();
                            }}
                            placeholder="Transmit message..."
                            className="min-w-0 flex-1 rounded-lg bg-slate-900/80 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-emerald-500/60"
                          />
                          <button
                            onClick={() => {
                              void handleSendMessage();
                            }}
                            disabled={isSendingMessage}
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSendingMessage ? "SENDING..." : "SEND"}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full min-h-[320px] items-center justify-center p-6 text-center">
                      <p className="text-sm text-slate-400">Open chat to message this agent.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Voice Indicator */}
      {isRecording && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-500/40 animate-ping" />
              <div className="relative rounded-full bg-emerald-500 p-4 shadow-2xl">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
            </div>
            <span className="rounded bg-black/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white italic animate-pulse">Recording...</span>
          </div>
        </div>
      )}
    </Html>
  );
}
