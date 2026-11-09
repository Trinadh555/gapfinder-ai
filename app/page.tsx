"use client";
import { useCallback, useEffect, useState } from "react";
import PlanSection from "./PlanSection";
import AuthGate from "./AuthGate";
import ExplainSection from "./ExplainSection";
import ProgressSection from "./ProgressSection";
import OverviewSection from "./OverviewSection";
import { authFetch } from "@/lib/authFetch";

type Doc = { id: string; name: string; kind: string; chunks: number };
type Topic = { id: string; name: string; subtopics: string[]; exam_count: number };
type Citation = { doc: string | null; page: number | null };
type Question = {
  id: string;
  topic_id: string;
  topic: string;
  subtopic: string | null;
  question: string;
  options: string[];
  citation: Citation;
};
type Result = {
  questionId: string;
  question: string;
  topic: string;
  options: string[];
  chosenIndex: number | null;
  correctIndex: number;
  isCorrect: boolean;
  explanation: string;
  correctExplanation: string;
  citation: Citation;
};
type Status = "weak" | "medium" | "strong";
type TopicReport = {
  topicId: string;
  name: string;
  total: number;
  correct: number;
  pct: number;
  status: Status;
  reason: string;
  examCount: number;
};
type Report = { attemptId: string; scorePct: number; results: Result[]; topics: TopicReport[] };

const STYLE: Record<Status, string> = {
  weak: "border-red-300 bg-red-50 text-red-900",
  medium: "border-amber-300 bg-amber-50 text-amber-900",
  strong: "border-blue-300 bg-blue-50 text-blue-900",
};
const LABEL: Record<Status, string> = {
  weak: "🔴 Weak",
  medium: "🟡 Medium",
  strong: "🔵 Strong",
};
const KIND_BADGE: Record<string, string> = {
  syllabus: "bg-blue-100 text-blue-700",
  notes: "bg-sky-100 text-sky-700",
  past_paper: "bg-amber-100 text-amber-700",
};
const KIND_LABEL: Record<string, string> = {
  syllabus: "Syllabus",
  notes: "Notes",
  past_paper: "Past paper",
};

async function post(url: string, body: unknown) {
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: `Server error (${res.status} ${res.statusText})` };
  }
  if (!res.ok) throw new Error(data?.error ?? "Request failed");
  return data;
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Card({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      className="scroll-mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      {children}
    </section>
  );
}

function StepTitle({
  n,
  title,
  right,
}: {
  n: number;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          {n}
        </span>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function Dashboard() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [kind, setKind] = useState("notes");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<Question[]>([]);
  const [skipped, setSkipped] = useState<{ topic: string; reason: string }[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [report, setReport] = useState<Report | null>(null);

  // Docs hidden by "Start new task" (saved in this browser)
  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      return new Set<string>(JSON.parse(localStorage.getItem("hiddenDocs") ?? "[]"));
    } catch {
      return new Set<string>();
    }
  });

  // Only these docs are used for the current task
  const visibleDocs = docs.filter((d) => !hidden.has(d.id));
  const activeDocIds = visibleDocs.map((d) => d.id);
  const chunkCount = visibleDocs.reduce((sum, d) => sum + d.chunks, 0);
  const syllabus = visibleDocs.find((d) => d.kind === "syllabus");
  const paper = visibleDocs.find((d) => d.kind === "past_paper");

  // Used after an upload to refresh the document list
  const loadDocs = useCallback(async () => {
    const res = await authFetch("/api/documents");
    if (res.ok) setDocs(await res.json());
  }, []);

  // Load documents once when the page opens
  useEffect(() => {
    let cancelled = false;
    authFetch("/api/documents")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled) setDocs(d);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load saved topic map for the syllabus (ESLint Safe)
  useEffect(() => {
    if (!syllabus?.id) return;
    let cancelled = false;
    authFetch(`/api/topics?syllabusDocId=${syllabus.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.topics?.length) {
          setTopics(d.topics);
          setSelected(new Set(d.topics.map((t: Topic) => t.id)));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [syllabus?.id]);

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("kind", kind);
    await run("Uploading...", async () => {
      const res = await authFetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      await loadDocs();
      form.reset();
    });
  }

  async function buildTopics() {
    if (!syllabus) return;
    const data = await run("Building topic map...", () =>
      post("/api/topics", {
        syllabusDocId: syllabus.id,
        pastPaperDocId: paper?.id,
        docIds: activeDocIds,
      })
    );
    if (data?.topics && Array.isArray(data.topics)) {
      setTopics(data.topics);
      setSelected(new Set(data.topics.map((t: Topic) => t.id)));
      setQuestions([]);
      setReport(null);
    }
  }

  // regenerate = true ignores cached questions and writes fresh ones
  async function generateQuiz(regenerate = false) {
    if (!syllabus) return;
    const data = await run(
      regenerate
        ? "Regenerating quiz with fresh questions..."
        : "Generating quiz from your material...",
      () =>
        post("/api/quiz", {
          syllabusDocId: syllabus.id,
          topicIds: Array.from(selected),
          perTopic: 2,
          docIds: activeDocIds,
          regenerate,
        })
    );
    if (data) {
      setQuestions(data.questions ?? []);
      setSkipped(data.skipped ?? []);
      setAnswers({});
      setReport(null);
    }
  }

  async function submit() {
    if (!syllabus) return;
    const data = await run("Evaluating answers...", () =>
      post("/api/evaluate", {
        syllabusDocId: syllabus.id,
        answers: questions.map((q) => ({
          questionId: q.id,
          chosenIndex: answers[q.id] ?? null,
        })),
      })
    );
    if (data) setReport(data);
  }

  // Hide all current docs and reset everything for a fresh task
  function startNewTask() {
    const next = new Set(hidden);
    docs.forEach((d) => next.add(d.id));
    setHidden(next);
    try {
      localStorage.setItem("hiddenDocs", JSON.stringify(Array.from(next)));
    } catch {}
    setTopics([]);
    setSelected(new Set());
    setQuestions([]);
    setSkipped([]);
    setAnswers({});
    setReport(null);
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const grouped = questions.reduce<Record<string, Question[]>>((acc, q) => {
    (acc[q.topic] ||= []).push(q);
    return acc;
  }, {});

  const input =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const btn =
    "rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40";
  const btnOutline =
    "rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 text-sm font-bold text-blue-600">◈ GapFinder AI</p>
            <p
              suppressHydrationWarning
              className="text-[11px] font-semibold uppercase tracking-widest text-slate-500"
            >
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
              Welcome back 👋
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Your knowledge gaps are a roadmap. Start with a quick material check-in.
            </p>
          </div>
          <button onClick={() => scrollTo("upload")} className={btn}>
            Upload material →
          </button>
        </header>

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            ⚠️ {error}
          </div>
        )}
        {busy && (
          <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
            <span>
              {busy} <span className="opacity-60">(can take up to a minute)</span>
            </span>
          </div>
        )}

        {/* Overview dashboard (refreshes after every new attempt) */}
        <OverviewSection
          key={`overview-${report?.attemptId ?? "initial"}`}
          syllabusDocId={syllabus?.id}
          topicCount={topics.length}
          materialCount={visibleDocs.length}
          chunkCount={chunkCount}
          onUpload={() => scrollTo("upload")}
          onQuiz={() => scrollTo("topics")}
          onGapReport={() => scrollTo(report ? "report" : "progress")}
          onPlan={() => scrollTo(report ? "plan" : "topics")}
        />

        <h2 className="pt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Your workspace
        </h2>

        {/* 1. Upload */}
        <Card id="upload">
          <StepTitle
            n={1}
            title="Upload study material"
            right={
              <button
                type="button"
                onClick={startNewTask}
                disabled={!!busy || visibleDocs.length === 0}
                className={btnOutline}
              >
                Start new task
              </button>
            }
          />
          <form onSubmit={onUpload} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
              <option value="syllabus">Syllabus</option>
              <option value="notes">Notes / Textbook</option>
              <option value="past_paper">Past paper</option>
            </select>
            <input
              type="file"
              name="file"
              accept=".pdf,.txt"
              required
              className={`${input} flex-1 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-blue-700`}
            />
            <button disabled={!!busy} className={btn}>
              Upload
            </button>
          </form>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {visibleDocs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate">📄 {d.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      KIND_BADGE[d.kind] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {KIND_LABEL[d.kind] ?? d.kind}
                  </span>
                  <span className="text-xs text-slate-400">{d.chunks} chunks</span>
                </span>
              </li>
            ))}
            {visibleDocs.length === 0 && (
              <li className="px-4 py-6 text-center text-slate-400">
                Nothing uploaded yet. Add a syllabus, notes and (optional) a past paper.
              </li>
            )}
          </ul>
        </Card>

        {/* 2. Topic map */}
        <Card id="topics">
          <StepTitle n={2} title="Topic map" />
          <button onClick={buildTopics} disabled={!syllabus || !!busy} className={btn}>
            {topics.length ? "Rebuild topic map" : "Build topic map"}
          </button>
          {!syllabus && <p className="text-sm text-slate-400">Upload a syllabus first.</p>}
          {topics.length > 0 && (
            <>
              <p className="text-sm text-slate-500">
                Tick the chapters you want to be tested on (only chapters whose notes you
                uploaded will get questions).
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Test</th>
                      <th className="px-4 py-2">Topic</th>
                      <th className="px-4 py-2">Subtopics</th>
                      <th className="px-4 py-2">In past paper</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topics.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-blue-600"
                            checked={selected.has(t.id)}
                            onChange={() => toggle(t.id)}
                          />
                        </td>
                        <td className="px-4 py-2 font-medium">{t.name}</td>
                        <td className="px-4 py-2">{t.subtopics?.length ?? 0}</td>
                        <td className="px-4 py-2">{t.exam_count} Qs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => generateQuiz(false)}
                  disabled={selected.size === 0 || !!busy}
                  className={btn}
                >
                  Generate diagnostic quiz
                </button>
                <button
                  onClick={() => generateQuiz(true)}
                  disabled={selected.size === 0 || !!busy}
                  className={btnOutline}
                  title="Ignore saved questions and write new ones from your notes"
                >
                  🔄 Regenerate quiz
                </button>
              </div>
            </>
          )}
        </Card>

        {/* 3. Quiz */}
        {questions.length > 0 && (
          <Card id="quiz">
            <StepTitle n={3} title="Diagnostic quiz" />
            {Object.entries(grouped).map(([topic, qs], groupIdx) => (
              <div key={`${topic}-${groupIdx}`} className="space-y-3">
                <h3 className="inline-block rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                  {topic}
                </h3>
                {qs.map((q, i) => (
                  <div key={q.id || `q-${i}`} className="space-y-2 rounded-xl border border-slate-200 p-4">
                    <p className="whitespace-pre-wrap font-medium">
                      {i + 1}. {q.question}
                    </p>
                    <div className="space-y-2">
                      {q.options.map((o, idx) => (
                        <label
                          key={idx}
                          className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                            answers[q.id] === idx
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-200 hover:bg-slate-50"
                          } ${report ? "cursor-default opacity-80" : "cursor-pointer"}`}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            className="mt-0.5 accent-blue-600"
                            disabled={!!report}
                            checked={answers[q.id] === idx}
                            onChange={() => setAnswers({ ...answers, [q.id]: idx })}
                          />
                          <span>{o}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400">
                      📖 Source: {q.citation.doc ?? "notes"}, page {q.citation.page ?? "?"}
                    </p>
                  </div>
                ))}
              </div>
            ))}
            {skipped.length > 0 && (
              <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-medium">
                  Skipped topics ({skipped.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {skipped.map((s, i) => (
                    <li key={`${s.topic}-${i}`}>
                      <b>{s.topic}:</b> {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!report && (
              <button onClick={submit} disabled={!!busy} className={btn}>
                Submit answers ({Object.keys(answers).length}/{questions.length} answered)
              </button>
            )}
          </Card>
        )}

        {/* 4. Gap report */}
        {report && (
          <Card id="report">
            <StepTitle n={4} title="Gap report" />
            <div className="flex items-center gap-4 rounded-xl bg-blue-50 p-4">
              <div className="text-4xl font-bold text-blue-700">{report.scorePct}%</div>
              <p className="text-sm text-blue-900">Overall score on this attempt</p>
            </div>
            <div className="space-y-2">
              {report.topics.map((t, i) => (
                <div key={`${t.topicId || t.name}-${i}`} className={`rounded-xl border p-4 ${STYLE[t.status]}`}>
                  <div className="flex justify-between gap-3 font-semibold">
                    <span>
                      {LABEL[t.status]} · {t.name}
                    </span>
                    <span>
                      {t.correct}/{t.total} ({t.pct}%)
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{t.reason}</p>
                  <p className="mt-1 text-xs opacity-70">
                    Appears in past paper: {t.examCount} question(s)
                  </p>
                </div>
              ))}
            </div>

            <h3 className="pt-2 font-semibold">Answer review</h3>
            {report.results.map((r, i) => (
              <div
                key={`${r.questionId || 'res'}-${i}`}
                className={`space-y-1 rounded-xl border p-4 text-sm ${
                  r.isCorrect ? "border-blue-200 bg-blue-50/50" : "border-red-200 bg-red-50/50"
                }`}
              >
                <p className="whitespace-pre-wrap font-medium">
                  {r.isCorrect ? "✅" : "❌"} {r.question}
                </p>
                {!r.isCorrect && (
                  <p>
                    <b>Your answer:</b>{" "}
                    {r.chosenIndex !== null ? r.options[r.chosenIndex] : "(not answered)"} —{" "}
                    {r.explanation}
                  </p>
                )}
                <p>
                  <b>Correct:</b> {r.options[r.correctIndex]} — {r.correctExplanation}
                </p>
                <p className="text-xs text-slate-400">
                  📖 {r.citation.doc ?? "notes"}, page {r.citation.page ?? "?"}
                </p>
              </div>
            ))}
          </Card>
        )}

        {/* 5. Revision plan (rebuilds after every new attempt) */}
        {report && syllabus && (
          <div id="plan" className="scroll-mt-6">
            <PlanSection key={`plan-${report.attemptId}`} syllabusDocId={syllabus.id} />
          </div>
        )}

        {/* 6. Explain this topic */}
        {syllabus && topics.length > 0 && (
          <ExplainSection topics={topics.map((t) => ({ id: t.id, name: t.name }))} />
        )}

        {/* 7. Progress dashboard */}
        {syllabus && (
          <div id="progress" className="scroll-mt-6">
            <ProgressSection
              key={`progress-${report?.attemptId ?? "initial"}`}
              syllabusDocId={syllabus.id}
            />
          </div>
        )}

        <footer className="pb-6 text-center text-xs text-slate-400">
          GapFinder AI · answers come only from your own uploaded material
        </footer>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}