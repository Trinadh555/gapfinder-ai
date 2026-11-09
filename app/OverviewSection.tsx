"use client";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";

type Progress = {
  attempts: { n: number; scorePct: number; createdAt: string }[];
  topics: { name: string; scores: (number | null)[] }[];
};

type Props = {
  syllabusDocId?: string;
  topicCount: number;
  materialCount: number;
  chunkCount: number;
  onUpload: () => void;
  onQuiz: () => void;
  onGapReport: () => void;
  onPlan: () => void;
};

const C = {
  strong: "#2563eb",
  medium: "#f59e0b",
  weak: "#ef4444",
  none: "#cbd5e1",
};

function latest(scores: (number | null)[]) {
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i] !== null) return scores[i] as number;
  }
  return null;
}

function level(p: number | null) {
  if (p === null) return { label: "Not tested", text: "text-slate-400", bar: "bg-slate-300" };
  if (p < 40) return { label: "Needs work", text: "text-red-600", bar: "bg-red-400" };
  if (p < 70) return { label: "Building", text: "text-amber-600", bar: "bg-amber-400" };
  return { label: "Strong", text: "text-blue-700", bar: "bg-blue-600" };
}

function StatCard({
  icon,
  value,
  label,
  foot,
}: {
  icon: string;
  value: string;
  label: string;
  foot: string;
}) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-lg">
        {icon}
      </span>
      <div className="mt-5">
        <p className="text-4xl font-bold tracking-tight text-slate-900">{value}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </div>
      <p className="mt-3 text-xs text-slate-400">{foot}</p>
    </div>
  );
}

function ChartCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400">{text}</p>
  );
}

// Area chart: score per attempt
function TrendChart({ attempts }: { attempts: Progress["attempts"] }) {
  const W = 600;
  const H = 240;
  const L = 40;
  const R = 20;
  const T = 18;
  const B = 34;
  const iw = W - L - R;
  const ih = H - T - B;
  const x = (i: number) =>
    attempts.length === 1 ? L + iw / 2 : L + (iw * i) / (attempts.length - 1);
  const y = (p: number) => T + ih * (1 - p / 100);
  const line = attempts.map((a, i) => `${x(i)},${y(a.scorePct)}`).join(" ");
  const area = `${x(0)},${y(0)} ${line} ${x(attempts.length - 1)},${y(0)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeDasharray="4 4" />
          <text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
            {g}
          </text>
        </g>
      ))}
      {attempts.length > 1 && <polygon points={area} fill="url(#trendFill)" />}
      {attempts.length > 1 && (
        <polyline
          points={line}
          fill="none"
          stroke="#2563eb"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {attempts.map((a, i) => (
        <g key={a.n}>
          <circle cx={x(i)} cy={y(a.scorePct)} r="6" fill="#fff" stroke="#2563eb" strokeWidth="3" />
          <text
            x={x(i)}
            y={y(a.scorePct) - 14}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill="#1d4ed8"
          >
            {a.scorePct}%
          </text>
          <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#94a3b8">
            Attempt {a.n}
          </text>
        </g>
      ))}
    </svg>
  );
}

// Donut chart: how many topics are strong / medium / weak / not tested
function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  const segs = parts.reduce<
    { label: string; color: string; start: number; len: number }[]
  >((acc, p) => {
    const start = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].len : 0;
    acc.push({ label: p.label, color: p.color, start, len: total ? (p.value / total) * c : 0 });
    return acc;
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <svg viewBox="0 0 200 200" className="h-44 w-44">
        <circle cx="100" cy="100" r={r} fill="none" stroke="#e2e8f0" strokeWidth="26" />
        {segs
          .filter((s) => s.len > 0)
          .map((s) => (
            <circle
              key={s.label}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="26"
              strokeDasharray={`${s.len} ${c - s.len}`}
              strokeDashoffset={-s.start}
              transform="rotate(-90 100 100)"
            />
          ))}
        <text x="100" y="98" textAnchor="middle" fontSize="30" fontWeight="700" fill="#0f172a">
          {total}
        </text>
        <text x="100" y="118" textAnchor="middle" fontSize="11" fill="#94a3b8">
          topics
        </text>
      </svg>
      <ul className="space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-600">{p.label}</span>
            <span className="ml-auto pl-4 font-semibold text-slate-900">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OverviewSection({
  syllabusDocId,
  topicCount,
  materialCount,
  chunkCount,
  onUpload,
  onQuiz,
  onGapReport,
  onPlan,
}: Props) {
  const [data, setData] = useState<Progress | null>(null);

  useEffect(() => {
    if (!syllabusDocId) return;
    let cancelled = false;
    authFetch(`/api/progress?syllabusDocId=${syllabusDocId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.attempts) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [syllabusDocId]);

  const prog = syllabusDocId ? data : null;
  const attempts = prog?.attempts ?? [];
  const last = attempts[attempts.length - 1];
  const best = attempts.length ? Math.max(...attempts.map((a) => a.scorePct)) : null;
  const rows = (prog?.topics ?? []).map((t) => ({
    name: t.name,
    pct: latest(t.scores),
    vals: t.scores.filter((s): s is number => s !== null),
  }));
  const explored = rows.filter((r) => r.pct !== null).length;
  const weak = rows.filter((r) => r.pct !== null && r.pct < 40);

  const counts = {
    strong: rows.filter((r) => r.pct !== null && r.pct >= 70).length,
    medium: rows.filter((r) => r.pct !== null && r.pct >= 40 && r.pct < 70).length,
    weak: weak.length,
    none: rows.filter((r) => r.pct === null).length,
  };

  const nextSteps = rows
    .filter((r) => r.pct === null || r.pct < 70)
    .sort((a, b) => (a.pct ?? 50) - (b.pct ?? 50))
    .slice(0, 3);

  const sortedRows = [...rows].sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1));
  const improvement = rows
    .filter((r) => r.vals.length >= 2)
    .map((r) => ({ name: r.name, first: r.vals[0], last: r.vals[r.vals.length - 1] }));

  let headline = "Let's find your gaps";
  let sub = "Upload your syllabus and notes, then take a quick diagnostic quiz.";
  if (attempts.length > 0) {
    sub = "Your gap report and revision plan are based on your quiz answers and uploaded sources.";
    headline =
      weak.length > 0
        ? `${weak.length} topic${weak.length > 1 ? "s" : ""} to focus on`
        : "No weak topics right now";
  } else if (topicCount > 0) {
    headline = "Ready for your first quiz";
    sub = "Your topic map is built. Take a diagnostic quiz to see where you stand.";
  }

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-linear-to-r from-blue-700 to-blue-500 p-8 text-white shadow-lg sm:p-10">
        <div className="relative z-10 max-w-md">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-blue-100">
            <span className="h-2 w-2 rounded-full bg-white" />
            Your learning snapshot
          </p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight">{headline}</h2>
          <p className="mt-3 text-sm leading-relaxed text-blue-50/90">{sub}</p>
          <button
            onClick={attempts.length > 0 ? onGapReport : onQuiz}
            className="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
          >
            {attempts.length > 0 ? "See my gap report →" : "Start with a quiz →"}
          </button>
        </div>
        <div className="pointer-events-none absolute right-6 top-1/2 hidden h-72 w-72 -translate-y-1/2 sm:block md:right-16">
          <div className="absolute inset-0 rounded-full border border-white/20" />
          <div className="absolute inset-8 rounded-full border border-white/20" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="-rotate-6 rounded-2xl bg-white px-8 py-10 text-center text-blue-700 shadow-xl">
              <p className="text-3xl font-bold">{topicCount}</p>
              <p className="mt-1 text-xs font-semibold">Topics in your material</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="🎯"
          value={last ? `${last.scorePct}%` : "–"}
          label="Latest score"
          foot={last ? new Date(last.createdAt).toLocaleDateString("en-GB") : "No quiz taken yet"}
        />
        <StatCard
          icon="🏆"
          value={best !== null ? `${best}%` : "–"}
          label="Best score"
          foot={`Across ${attempts.length} quiz attempt${attempts.length === 1 ? "" : "s"}`}
        />
        <StatCard
          icon="🧭"
          value={`${explored}/${rows.length || topicCount}`}
          label="Topics explored"
          foot="Computed from tested topics"
        />
        <StatCard
          icon="📚"
          value={String(materialCount)}
          label="Materials uploaded"
          foot={`${chunkCount} indexed source chunks`}
        />
      </div>

      {/* Trend + donut */}
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <ChartCard title="Score trend" sub="Your overall score on every attempt">
          {attempts.length > 0 ? (
            <TrendChart attempts={attempts} />
          ) : (
            <Empty text="No attempts yet. Your score line will appear here." />
          )}
        </ChartCard>

        <ChartCard title="Performance split" sub="Topics by latest result">
          {rows.length > 0 ? (
            <Donut
              parts={[
                { label: "Strong (70%+)", value: counts.strong, color: C.strong },
                { label: "Medium (40–69%)", value: counts.medium, color: C.medium },
                { label: "Weak (<40%)", value: counts.weak, color: C.weak },
                { label: "Not tested", value: counts.none, color: C.none },
              ]}
            />
          ) : (
            <Empty text="Build your topic map to see the split." />
          )}
        </ChartCard>
      </div>

      {/* Topic bars + improvement */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Topic mastery" sub="Weakest topics first">
          {sortedRows.length > 0 ? (
            <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
              {sortedRows.map((r, i) => {
                const lv = level(r.pct);
                return (
                  <li key={`${r.name}-${i}`} className="text-sm">
                    <div className="mb-1 flex justify-between gap-3">
                      <span className="truncate">{r.name}</span>
                      <span className={`shrink-0 font-semibold ${lv.text}`}>
                        {r.pct === null ? "–" : `${r.pct}%`}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${lv.bar}`}
                        style={{ width: `${r.pct ?? 0}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty text="Build your topic map to see mastery here." />
          )}
        </ChartCard>

        <ChartCard title="Improvement" sub="First attempt vs latest attempt, per topic">
          {improvement.length > 0 ? (
            <ul className="max-h-96 space-y-4 overflow-y-auto pr-1">
              {improvement.map((r, i) => {
                const d = r.last - r.first;
                return (
                  <li key={`${r.name}-${i}`} className="text-sm">
                    <div className="mb-1 flex justify-between gap-3">
                      <span className="truncate">{r.name}</span>
                      <span
                        className={`shrink-0 font-semibold ${
                          d > 0 ? "text-blue-700" : d < 0 ? "text-red-600" : "text-slate-400"
                        }`}
                      >
                        {d > 0 ? `↑ +${d}` : d < 0 ? `↓ ${d}` : "→ 0"}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-slate-400"
                            style={{ width: `${r.first}%` }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs text-slate-400">{r.first}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${r.last}%` }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs font-semibold text-blue-700">
                          {r.last}%
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty text="Take at least 2 attempts on the same topic to see improvement." />
          )}
        </ChartCard>
      </div>

      {/* Next steps */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">Next revision steps</h3>
            <p className="text-xs text-slate-400">Priority follows weakness</p>
          </div>
          <button onClick={onPlan} className="text-xs font-semibold text-blue-600 hover:underline">
            Open plan →
          </button>
        </div>
        <ul className="mt-4 divide-y divide-slate-100">
          {nextSteps.map((s, i) => (
            <li key={`${s.name}-${i}`} className="flex gap-3 py-3">
              <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-slate-300" />
              <div className="text-sm">
                <p className="font-medium">
                  Day {Math.floor(i / 2) + 1}: Review {s.name}
                </p>
                <p className="text-xs text-slate-400">
                  30 min · {s.pct === null ? "Not tested yet" : `${s.pct}% correct`}
                </p>
              </div>
            </li>
          ))}
          {nextSteps.length === 0 && (
            <li className="py-6 text-center text-sm text-slate-400">
              {attempts.length > 0
                ? "Nothing urgent. Keep revising 🎉"
                : "Take a quiz to get your steps."}
            </li>
          )}
        </ul>
        <div className="mt-2 flex flex-wrap gap-3">
          <button
            onClick={onQuiz}
            className="flex-1 rounded-xl bg-blue-50 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
          >
            Take a diagnostic quiz →
          </button>
          <button
            onClick={onUpload}
            className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Upload material →
          </button>
        </div>
      </section>
    </div>
  );
}