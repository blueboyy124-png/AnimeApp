"use client";

import { useState } from "react";
import { signInWithUsername, signUpAccount, setAccountPassword } from "./utils/supabase";

type Mode = "login" | "signup" | "set-password";

interface AuthPageProps {
  mode: Mode;
  // Locked username, used only in "set-password" mode so the person can't
  // accidentally rename their account while just adding a password.
  lockedUsername?: string;
  onSuccess: () => void;
  // "set-password" is triggered from inside the app (a banner), so it needs
  // a way back out without logging anyone in/out.
  onCancel?: () => void;
}

export default function AuthPage({ mode: initialMode, lockedUsername, onSuccess, onCancel }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState(lockedUsername || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode !== "login" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await signInWithUsername(username, password);
      } else if (mode === "signup") {
        await signUpAccount(username, email, password);
      } else {
        await setAccountPassword(password);
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Set a Password";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-black tracking-tighter text-orange-500">STREAMANIME</h1>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">{title}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-neutral-900/50 border border-neutral-800 rounded-xl p-6">
          {mode !== "set-password" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Username</label>
              <input
                type="text"
                value={username}
                disabled={!!lockedUsername}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                className="w-full px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="yourusername"
              />
            </div>
          )}

          {mode === "set-password" && lockedUsername && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Username</label>
              <input
                type="text"
                value={lockedUsername}
                disabled
                className="w-full px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 text-sm opacity-50 cursor-not-allowed"
              />
            </div>
          )}

          {mode === "signup" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 text-sm focus:outline-none focus:border-orange-500"
                placeholder="you@example.com"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">
              {mode === "set-password" ? "New Password" : "Password"}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 text-sm focus:outline-none focus:border-orange-500"
              placeholder="••••••••"
            />
          </div>

          {mode !== "login" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 text-sm focus:outline-none focus:border-orange-500"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <p className="text-xs font-mono text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-md bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-sm font-bold uppercase tracking-widest transition cursor-pointer"
          >
            {submitting ? "Please wait..." : mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Save Password"}
          </button>

          {mode === "set-password" && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2 text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-neutral-300 transition cursor-pointer"
            >
              Not now
            </button>
          )}
        </form>

        {mode !== "set-password" && (
          <p className="text-center text-xs text-neutral-500">
            {mode === "login" ? (
              <>
                Don't have an account?{" "}
                <button onClick={() => { setError(null); setMode("signup"); }} className="text-orange-500 hover:underline cursor-pointer">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button onClick={() => { setError(null); setMode("login"); }} className="text-orange-500 hover:underline cursor-pointer">
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}