"use client";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";

type Progress = {
  attempts: { n: number; scorePct: number; createdAt: string }[];
  topics: { name: string; scores: (number | null)[] }[];
};

function cell(p: number | null) {
  if (p === null) return "";
  if (p < 40) return "bg-red-100 text-red-900";
  if (p < 70) return "bg-yellow-100 text-yellow-900";
  return "bg-green-100 text-green-900";
}

function trend(scores: (number | null)[]) {
  const vals = scores.filter((s): s is number => s !== null);
  if (vals.length < 2) return "–";
  const d = vals[vals.length - 1] - vals[0];
  if (d > 0) return `↑ +${d}`;
  if (d < 0) return `↓ ${d}`;
  return "→ 0";
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

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="text-xl font-semibold">7. Progress dashboard</h2>
      {loading && <p className="text-sm opacity-60">Loading...</p>}
      {!loading && (!data || data.attempts.length === 0) && (
        <p className="text-sm opacity-60">
          No attempts yet. Take a diagnostic quiz to start tracking progress.
        </p>
      )}
      {data && data.attempts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">Topic</th>
                {data.attempts.map((a) => (
                  <th key={a.n} className="p-2">
                    Attempt {a.n}
                  </th>
                ))}
                <th className="p-2">Change</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b font-semibold">
                <td className="p-2">Overall</td>
                {data.attempts.map((a) => (
                  <td key={a.n} className={`p-2 ${cell(a.scorePct)}`}>
                    {a.scorePct}%
                  </td>
                ))}
                <td className="p-2">{trend(data.attempts.map((a) => a.scorePct))}</td>
              </tr>
              {data.topics.map((t) => (
                <tr key={t.name} className="border-b">
                  <td className="p-2">{t.name}</td>
                  {t.scores.map((s, i) => (
                    <td key={i} className={`p-2 ${cell(s)}`}>
                      {s === null ? "–" : `${s}%`}
                    </td>
                  ))}
                  <td className="p-2">{trend(t.scores)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}