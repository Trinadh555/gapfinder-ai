"use client";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";

type Progress = {
  attempts: { n: number; scorePct: number; createdAt: string }[];
  topics: { name: string; scores: (number | null)[] }[];
};

function cell(p: number | null) {
  if (p === null) return "text-slate-300";
  if (p < 40) return "bg-red-50 font-medium text-red-700";
  if (p < 70) return "bg-amber-50 font-medium text-amber-700";
  return "bg-blue-50 font-medium text-blue-700";
}

function trend(scores: (number | null)[]) {
  const vals = scores.filter((s): s is number => s !== null);
  if (vals.length < 2) return { text: "–", color: "text-slate-400" };
  const d = vals[vals.length - 1] - vals[0];
  if (d > 0) return { text: `↑ +${d}`, color: "text-blue-600" };
  if (d < 0) return { text: `↓ ${d}`, color: "text-red-600" };
  return { text: "→ 0", color: "text-slate-500" };
}

export default function ProgressSection({ syllabusDocId }: { syllabusDocId: string }) {
  const [data, setData] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/progress?syllabusDocId=${syllabusDocId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.attempts) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syllabusDocId]);

  const overall = data ? trend(data.attempts.map((a) => a.scorePct)) : null;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          7
        </span>
        <h2 className="text-xl font-semibold text-slate-900">Progress dashboard</h2>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading...</p>}
      {!loading && (!data || data.attempts.length === 0) && (
        <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-400">
          No attempts yet. Take a diagnostic quiz to start tracking progress.
        </p>
      )}

      {data && data.attempts.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Topic</th>
                {data.attempts.map((a) => (
                  <th key={a.n} className="px-4 py-2">
                    Attempt {a.n}
                  </th>
                ))}
                <th className="px-4 py-2">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/50 font-semibold">
                <td className="px-4 py-2">Overall</td>
                {data.attempts.map((a) => (
                  <td key={a.n} className={`px-4 py-2 ${cell(a.scorePct)}`}>
                    {a.scorePct}%
                  </td>
                ))}
                <td className={`px-4 py-2 ${overall?.color ?? ""}`}>{overall?.text}</td>
              </tr>
              {data.topics.map((t, ti) => {
                const tr = trend(t.scores);
                return (
                  <tr key={`${t.name}-${ti}`} className="hover:bg-slate-50">
                    <td className="px-4 py-2">{t.name}</td>
                    {t.scores.map((s, i) => (
                      <td key={i} className={`px-4 py-2 ${cell(s)}`}>
                        {s === null ? "–" : `${s}%`}
                      </td>
                    ))}
                    <td className={`px-4 py-2 font-medium ${tr.color}`}>{tr.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}