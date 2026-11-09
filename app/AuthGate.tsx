"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const DEMO_EMAIL = "demo@gapfinder.ai";
const DEMO_PASSWORD = "Demo@12345";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  // undefined = still checking, null = logged out
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabaseBrowser.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(e: string, p: string) {
    if (!e.trim() || !p) {
      setMsg("Enter your email and password first.");
      return;
    }
    setBusy(true);
    setMsg("");
    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email: e.trim(),
      password: p,
    });
    if (error) setMsg(error.message);
    setBusy(false);
  }

  async function signUp() {
    if (!email.trim() || password.length < 6) {
      setMsg(
        "Enter your email and a password (at least 6 characters), then click Create account."
      );
      return;
    }
    setBusy(true);
    setMsg("");
    const { data, error } = await supabaseBrowser.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) setMsg(error.message);
    else if (!data.session) setMsg("Account created. Confirm your email, then sign in.");
    setBusy(false);
  }

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm font-medium text-slate-400">Loading...</p>
      </div>
    );
  }

  if (session === null) {
    const input =
      "w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
    const btn =
      "w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40";
    return (
      <main className="mx-auto mt-16 max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="space-y-1">
          <p className="text-sm font-bold text-blue-600">◈ GapFinder AI</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome</h1>
          <p className="text-sm text-slate-500">Log in to see your gaps and revision plan.</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            signIn(email, password);
          }}
          className="space-y-3 pt-2"
        >
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
          <button disabled={busy} className={btn}>
            Sign in
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={signUp}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            Create account
          </button>
        </form>

        {msg && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900">
            {msg}
          </div>
        )}

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => signIn(DEMO_EMAIL, DEMO_PASSWORD)}
            className="w-full rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100/70 disabled:opacity-40"
          >
            Use demo account
          </button>
          <p className="text-center text-xs text-slate-400">
            Demo login: <span className="font-mono text-slate-600">{DEMO_EMAIL}</span> /{" "}
            <span className="font-mono text-slate-600">{DEMO_PASSWORD}</span>
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 text-xs sm:px-8">
          <span className="flex items-center gap-2 font-medium text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Signed in as <strong className="text-slate-700">{session.user.email}</strong>
          </span>
          <button
            onClick={() => supabaseBrowser.auth.signOut()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </div>
      <div key={session.user.id}>{children}</div>
    </>
  );
}