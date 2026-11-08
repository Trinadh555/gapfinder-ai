"use client";
import { useEffect, useState } from "react";

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

const DOT: Record<Status, string> = { weak: "🔴", medium: "🟡", strong: "🟢" };

export default function PlanSection({ syllabusDocId }: { syllabusDocId: string }) {
  // draft = what the user is typing, params = what the plan was built with
  const [draft, setDraft] = useState({ days: 5, hours: 2 });
  const [params, setParams] = useState({ days: 5, hours: 2 });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/plan", {
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

  const input = "w-20 border p-1 bg-white text-black";

  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="text-xl font-semibold">5. Your revision plan</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>
          Days left{" "}
          <input
            type="number"
            min={1}
            max={30}
            value={draft.days}
            onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}
            className={input}
          />
        </label>
        <label>
          Hours per day{" "}
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
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
        >
          {loading ? "Planning..." : "Update plan"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-400 bg-red-100 p-3 text-sm text-red-900">
          {error}
        </div>
      )}
      {plan?.message && <p>{plan.message}</p>}

      {plan && plan.topics.length > 0 && (
        <>
          <div className="space-y-2">
            <h3 className="font-semibold">Priority order</h3>
            {plan.topics.map((t, i) => (
              <div key={t.name} className="rounded border p-3 text-sm">
                <div className="flex justify-between font-semibold">
                  <span>
                    {i + 1}. {DOT[t.status]} {t.name}
                  </span>
                  <span>
                    {t.minutes} min · score {t.pct}%
                  </span>
                </div>
                <p>{t.tip}</p>
                <p className="text-xs opacity-60">
                  Past paper questions: {t.examCount}
                  {t.sources.length > 0 && ` · Revise: ${t.sources.join("; ")}`}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">Day by day</h3>
            {plan.days
              .filter((d) => d.sessions.length > 0)
              .map((d) => (
                <div key={d.day} className="rounded border p-3 text-sm">
                  <p className="font-semibold">
                    Day {d.day} <span className="opacity-60">({d.used} min)</span>
                  </p>
                  <ul className="list-disc pl-5">
                    {d.sessions.map((s, i) => (
                      <li key={i}>
                        {DOT[s.status]} {s.topic} — {s.minutes} min
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </>
      )}
    </section>
  );
}