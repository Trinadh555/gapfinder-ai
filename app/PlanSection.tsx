"use client";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";

type Status = "weak" | "medium" | "strong";
type Session = { topic: string; minutes: number; status: Status };
type Day = { day: number; used: number; sessions: Session[] };
type PlanTopic = {
  name: string;
  pct: number;
  status: Status;
  minutes: number;
  examCount: number;
  sources: string[];
  tip: string;
};
type Plan = { days: Day[]; topics: PlanTopic[]; message?: string };

const DOT: Record<Status, string> = { weak: "🔴", medium: "🟡", strong: "🔵" };
const BORDER: Record<Status, string> = {
  weak: "border-l-red-400",
  medium: "border-l-amber-400",
  strong: "border-l-blue-500",
};

export default function PlanSection({ syllabusDocId }: { syllabusDocId: string }) {
  // draft = what the user is typing, params = what the plan was built with
  const [draft, setDraft] = useState({ days: 5, hours: 2 });
  const [params, setParams] = useState({ days: 5, hours: 2 });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    authFetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        syllabusDocId,
        days: params.days,
        hoursPerDay: params.hours,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not build plan");
        return data as Plan;
      })
      .then((data) => {
        if (!cancelled) setPlan(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syllabusDocId, params]);

  function update() {
    setLoading(true);
    setError("");
    setParams({ ...draft });
  }

  const input =
    "w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          5
        </span>
        <h2 className="text-xl font-semibold text-slate-900">Your revision plan</h2>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4 text-sm">
        <label className="flex flex-col gap-1 text-slate-600">
          Days left
          <input
            type="number"
            min={1}
            max={30}
            value={draft.days}
            onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-slate-600">
          Hours per day
          <input
            type="number"
            min={0.5}
            max={12}
            step={0.5}
            value={draft.hours}
            onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })}
            className={input}
          />
        </label>
        <button
          onClick={update}
          disabled={loading}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Planning..." : "Update plan"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          ⚠️ {error}
        </div>
      )}
      {plan?.message && <p className="text-sm text-slate-600">{plan.message}</p>}

      {plan && plan.topics.length > 0 && (
        <>
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-900">Priority order</h3>
            {plan.topics.map((t, i) => (
              <div
                key={`${t.name}-${i}`}
                className={`rounded-xl border border-l-4 border-slate-200 p-4 text-sm ${BORDER[t.status]}`}
              >
                <div className="flex flex-wrap justify-between gap-2 font-semibold">
                  <span>
                    {i + 1}. {DOT[t.status]} {t.name}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs font-medium text-slate-700">
                    {t.minutes} min · score {t.pct}%
                  </span>
                </div>
                <p className="mt-1 text-slate-700">{t.tip}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Past paper questions: {t.examCount}
                  {t.sources.length > 0 && ` · Revise: ${t.sources.join("; ")}`}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-slate-900">Day by day</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {plan.days
                .filter((d) => d.sessions.length > 0)
                .map((d) => (
                  <div
                    key={d.day}
                    className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-sm"
                  >
                    <p className="font-semibold text-blue-700">
                      Day {d.day}{" "}
                      <span className="font-normal text-slate-400">({d.used} min)</span>
                    </p>
                    <ul className="mt-2 space-y-1">
                      {d.sessions.map((s, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>
                            {DOT[s.status]} {s.topic}
                          </span>
                          <span className="shrink-0 text-slate-500">{s.minutes} min</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}