"use client";

import { useOfficeStore } from "@/src/store/useOfficeStore";

const ELEVATOR_FLOORS = [
  { id: 7, name: "Executive Floor" },
  { id: 6, name: "Sales" },
  { id: 5, name: "Marketing" },
  { id: 4, name: "Engineering" },
  { id: 3, name: "Administration" },
  { id: 2, name: "Human Resources" },
  { id: 1, name: "Lobby" },
];

export function ElevatorModal() {
  const { selectedFloor, setSelectedFloor, setShowElevatorModal } = useOfficeStore();

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 pointer-events-auto">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
             <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
             </svg>
             <h2 className="text-xl font-bold text-white">Elevator Control</h2>
          </div>
          <button onClick={() => setShowElevatorModal(false)} className="text-slate-400 hover:text-white transition">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <div className="grid gap-2">
            {ELEVATOR_FLOORS.map((floor) => (
              <button
                key={floor.id}
                onClick={() => {
                  setSelectedFloor(floor.id);
                  setShowElevatorModal(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl border p-4 transition-all ${
                  selectedFloor === floor.id
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : "border-white/5 bg-slate-950/50 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg font-black ${
                    selectedFloor === floor.id ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-900 text-slate-500"
                  }`}>
                    {floor.id}
                  </span>
                  <div className="text-left">
                    <p className="text-sm font-bold">{floor.name}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Department Floor</p>
                  </div>
                </div>
                {selectedFloor === floor.id && (
                  <span className="text-[10px] font-bold bg-emerald-500 text-white px-2 py-0.5 rounded-full uppercase">Current</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-950/50 px-6 py-4 border-t border-white/10 text-center">
           <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Emergency Contact: Office Operations Security</p>
        </div>
      </div>
    </div>
  );
}
