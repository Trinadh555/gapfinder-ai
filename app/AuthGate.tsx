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
    setBusy(true);
    setMsg("");
    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email: e,
      password: p,
    });
    if (error) setMsg(error.message);
    setBusy(false);
  }

  async function signUp() {
    setBusy(true);
    setMsg("");
    const { data, error } = await supabaseBrowser.auth.signUp({ email, password });
    if (error) setMsg(error.message);
    else if (!data.session) setMsg("Account created. Confirm your email, then sign in.");
    setBusy(false);
  }

  if (session === undefined) {
    return <p className="p-8 text-sm opacity-60">Loading...</p>;
  }

  if (session === null) {
    const input = "w-full border bg-white p-2 text-black";
    const btn = "w-full rounded bg-black px-4 py-2 text-white disabled:opacity-40";
    return (
      <main className="mx-auto mt-16 max-w-sm space-y-4 rounded border p-6">
        <h1 className="text-2xl font-bold">GapFinder AI</h1>
        <p className="text-sm opacity-70">Log in to see your gaps and revision plan.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            signIn(email, password);
          }}
          className="space-y-3"
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
            className="w-full rounded border px-4 py-2 disabled:opacity-40"
          >
            Create account
          </button>
        </form>

        {msg && (
          <div className="rounded border border-red-400 bg-red-100 p-2 text-sm text-red-900">
            {msg}
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => signIn(DEMO_EMAIL, DEMO_PASSWORD)}
            className="w-full rounded border border-blue-500 px-4 py-2 text-blue-700 disabled:opacity-40"
          >
            Use demo account
          </button>
          <p className="text-xs opacity-60">
            Demo login: {DEMO_EMAIL} / {DEMO_PASSWORD}
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 pt-4 text-sm">
        <span className="opacity-70">Signed in as {session.user.email}</span>
        <button
          onClick={() => supabaseBrowser.auth.signOut()}
          className="rounded border px-3 py-1"
        >
          Sign out
        </button>
      </div>
      <div key={session.user.id}>{children}</div>
    </>
  );
}