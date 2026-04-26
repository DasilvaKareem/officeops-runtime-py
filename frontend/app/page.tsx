"use client";

import { useState, useEffect } from "react";
import { OfficeScene } from "@/src/components/office/OfficeScene";
import { BuildingScene } from "@/src/components/office/BuildingScene";
import { OverlayUI } from "@/src/components/office/OverlayUI";
import { CharacterCustomizer } from "@/src/components/office/CharacterCustomizer";
import { FirebaseSync } from "@/src/components/office/FirebaseSync";
import { ElevatorModal } from "@/src/components/office/ElevatorModal";
import { useOfficeStore } from "@/src/store/useOfficeStore";
import { auth } from "@/src/lib/firebase";
import { FirebaseError } from "firebase/app";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  updateProfile
} from "firebase/auth";

function RegistrationModal({ onClose }: { onClose: () => void }) {
  const { userProfile, setUserProfile } = useOfficeStore();
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFinish = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isLogin) {
        // Handle Login
        await signInWithEmailAndPassword(auth, userProfile.email, password);
        // FirebaseSync handles state update
        onClose();
      } else {
        // Handle Registration
        const userCredential = await createUserWithEmailAndPassword(auth, userProfile.email, password);
        await updateProfile(userCredential.user, { displayName: userProfile.name });
        // FirebaseSync handles state update
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof FirebaseError ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/50 px-6 py-4">
          <h2 className="text-xl font-bold text-white">
            {isLogin ? "Access Your Agency" : "Create Your Agent CEO Profile"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Left Side: Form */}
            <div className="w-full lg:w-1/3 space-y-6">
              <div className="space-y-4">
                {!isLogin && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
                      <input
                        type="text"
                        value={userProfile.name}
                        onChange={(e) => setUserProfile({ name: e.target.value })}
                        placeholder="Enter your name"
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Company Name</label>
                      <input
                        type="text"
                        value={userProfile.companyName}
                        onChange={(e) => setUserProfile({ companyName: e.target.value })}
                        placeholder="e.g. Acme Corp"
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
                      />
                    </div>
                  </>
                )}
                
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={userProfile.email}
                    onChange={(e) => setUserProfile({ email: e.target.value })}
                    placeholder="ceo@company.com"
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
                  />
                </div>

                {!isLogin && (
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Phone Number</label>
                    <input
                      type="tel"
                      value={userProfile.phone}
                      onChange={(e) => setUserProfile({ phone: e.target.value })}
                      placeholder="+1 (555) 000-0000"
                      className="w-full rounded-lg border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 p-3 border border-red-500/20 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="rounded-xl bg-emerald-500/10 p-4 border border-emerald-500/20">
                <h3 className="mb-1 text-sm font-semibold text-emerald-400">Profile Configuration</h3>
                <p className="text-xs text-slate-300">Your custom avatar will represent you on the Executive Floor and during interactions with your AI agents.</p>
              </div>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setError(null);
                  }}
                  className="text-sm text-emerald-400 hover:text-emerald-300 underline"
                >
                  {isLogin ? "Need to register an agency?" : "Already have an agency? Log In"}
                </button>
              </div>
            </div>

            {/* Right Side: 3D Customizer */}
            <div className="flex-1">
              <CharacterCustomizer />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center border-t border-white/10 bg-slate-900/50 px-6 py-6">
          <button
            onClick={handleFinish}
            disabled={loading || !userProfile.email || !password || (!isLogin && !userProfile.name)}
            className="flex min-h-14 min-w-64 items-center justify-center gap-3 rounded-xl bg-emerald-600 px-10 py-4 text-lg font-black text-white shadow-2xl shadow-emerald-950/40 transition hover:scale-[1.02] hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
            {isLogin ? "Enter Company" : "Start Your Company"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { viewMode, isLoggedIn, setIsLoggedIn, userProfile, authInitialized, showElevatorModal } = useOfficeStore();
  const [showRegistration, setShowRegistration] = useState(false);
  const [showCommandMenu, setShowCommandMenu] = useState(false);

  const handleLogout = async () => {
    await signOut(auth);
    setIsLoggedIn(false);
  };

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyM" || event.repeat || isTypingTarget(event.target)) return;
      if (viewMode !== "office" || showRegistration) return;
      event.preventDefault();
      setShowCommandMenu((open) => !open);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showRegistration, viewMode]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050b16]">
      <FirebaseSync />

      {!authInitialized ? (
        <div className="h-screen w-screen bg-[#050b16] flex items-center justify-center text-emerald-500 tracking-widest font-semibold">
          LOADING HQ...
        </div>
      ) : (
        <>
          {viewMode === "building" ? <BuildingScene /> : <OfficeScene />}
      
          {viewMode === "office" && showCommandMenu ? (
            <OverlayUI onClose={() => setShowCommandMenu(false)} />
          ) : null}

          {viewMode === "office" && !showCommandMenu ? (
            <button
              type="button"
              onClick={() => setShowCommandMenu(true)}
              className="pointer-events-auto absolute left-4 top-4 z-30 flex items-center gap-2 rounded-full border border-emerald-400/30 bg-slate-950/80 px-3 py-2 text-white shadow-xl shadow-black/30 backdrop-blur-md transition hover:border-emerald-300/60 hover:bg-slate-900"
              aria-label="Open master command menu"
            >
              <span className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-xs font-black text-emerald-200">
                M
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Menu</span>
            </button>
          ) : null}

          {viewMode === "office" && showElevatorModal ? <ElevatorModal /> : null}

          {showRegistration && !isLoggedIn && <RegistrationModal onClose={() => setShowRegistration(false)} />}

          {/* Building View Overlay / Top Bar */}
          {viewMode === "building" && (
            <div className="pointer-events-none absolute inset-0 p-6">
              {!isLoggedIn ? (
                <div className="flex h-full items-center justify-center">
                  <button
                    onClick={() => setShowRegistration(true)}
                    className="pointer-events-auto rounded-2xl bg-emerald-600 px-12 py-5 text-xl font-black text-white shadow-2xl shadow-emerald-950/50 transition hover:scale-[1.03] hover:bg-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-300/30"
                  >
                    Start Your Company
                  </button>
                </div>
              ) : (
                <div className="flex justify-between">
                  <div className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/85 p-4 shadow-xl backdrop-blur-md">
                    <h1 className="text-3xl font-bold text-white tracking-tight">
                      {userProfile.companyName || "Your Company"}
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">Select a floor to enter your AI Agency</p>
                  </div>

                  <div className="pointer-events-auto">
                    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-slate-950/80 px-4 py-2 backdrop-blur-md">
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-semibold text-white">{userProfile.name || "CEO"}</span>
                        <span className="text-xs text-emerald-400">{userProfile.companyName || "Authenticated"}</span>
                      </div>
                      <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-emerald-500 bg-slate-800">
                        <img 
                          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${userProfile.name || "CEO"}`} 
                          alt="CEO Avatar" 
                        />
                      </div>
                      <button
                        onClick={handleLogout}
                        className="ml-2 text-xs text-slate-400 hover:text-white"
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
