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

type PdfTextItem = { str?: string };
type PdfJsGlobal = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: PdfTextItem[] }>;
      }>;
    }>;
  };
};

declare global {
  interface Window {
    pdfjsLib?: PdfJsGlobal;
  }
}

async function extractTextClientSide(file: File): Promise<string[]> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return [await file.text()];
  }

  if (typeof window === "undefined") return [];

  if (!window.pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error("Could not initialize PDF reader");

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: PdfTextItem) => item.str ?? "")
      .join(" ");
    pages.push(pageText);
  }

  return pages;
}

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
  const [perTopic, setPerTopic] = useState<number>(2); // User selectable question count
  const [skipped, setSkipped] = useState<{ topic: string; reason: string }[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [report, setReport] = useState<Report | null>(null);

  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      return new Set<string>(JSON.parse(localStorage.getItem("hiddenDocs") ?? "[]"));
    } catch {
      return new Set<string>();
    }
  });

  const visibleDocs = docs.filter((d) => !hidden.has(d.id));
  const activeDocIds = visibleDocs.map((d) => d.id);
  const chunkCount = visibleDocs.reduce((sum, d) => sum + d.chunks, 0);

  const syllabus = visibleDocs.find((d) => d.kind === "syllabus");
  const effectiveSyllabus =
    syllabus || visibleDocs.find((d) => d.kind === "notes") || visibleDocs[0];
  const paper = visibleDocs.find((d) => d.kind === "past_paper");

  const loadDocs = useCallback(async () => {
    const res = await authFetch("/api/documents");
    if (res.ok) setDocs(await res.json());
  }, []);

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

  useEffect(() => {
    if (!effectiveSyllabus?.id) return;
    let cancelled = false;
    authFetch(`/api/topics?syllabusDocId=${effectiveSyllabus.id}`)
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
  }, [effectiveSyllabus?.id]);

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
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) return;

    await run("Processing and uploading...", async () => {
      let res;
      try {
        const pages = await extractTextClientSide(file);
        res = await authFetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, kind, pages }),
        });
      } catch (clientErr) {
        console.warn("Client extraction fallback to formData:", clientErr);
        const fd = new FormData(form);
        fd.set("kind", kind);
        res = await authFetch("/api/upload", { method: "POST", body: fd });
      }

      let data;
      try {
        data = await res.json();
      } catch {
        if (res.status === 413) {
          throw new Error("File is too large for hosting. Please compress the PDF.");
        }
        throw new Error(`Upload failed (${res.status} ${res.statusText})`);
      }

      if (!res.ok) throw new Error(data?.error ?? "Upload failed");
      await loadDocs();
      form.reset();
    });
  }

  async function deleteDoc(docId: string, docName: string) {
    if (!confirm(`Are you sure you want to delete "${docName}"?`)) return;

    await run("Deleting document...", async () => {
      const res = await authFetch(`/api/documents?id=${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete document");
      }
      if (effectiveSyllabus?.id === docId) {
        setTopics([]);
        setSelected(new Set());
        setQuestions([]);
        setReport(null);
      }
      await loadDocs();
    });
  }

  async function buildTopics() {
    if (!effectiveSyllabus) return;
    const data = await run("Building topic map...", () =>
      post("/api/topics", {
        syllabusDocId: effectiveSyllabus.id,
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

  async function generateQuiz(regenerate = false) {
    if (!effectiveSyllabus) return;
    const data = await run(
      regenerate
        ? "Regenerating quiz with fresh questions..."
        : "Generating diagnostic quiz...",
      () =>
        post("/api/quiz", {
          syllabusDocId: effectiveSyllabus.id,
          topicIds: Array.from(selected),
          perTopic,
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
    if (!effectiveSyllabus) return;
    const data = await run("Evaluating answers...", () =>
      post("/api/evaluate", {
        syllabusDocId: effectiveSyllabus.id,
        answers: questions.map((q) => ({
          questionId: q.id,
          chosenIndex: answers[q.id] ?? null,
        })),
      })
    );
    if (data) setReport(data);
  }

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

  const input =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const btn =
    "rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40";
  const btnOutline =
    "rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8">
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
              {busy} <span className="opacity-60">(can take a moment)</span>
            </span>
          </div>
        )}

        <OverviewSection
          key={`overview-${report?.attemptId ?? "initial"}`}
          syllabusDocId={effectiveSyllabus?.id}
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
              <option value="notes">Notes / Textbook</option>
              <option value="syllabus">Syllabus</option>
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
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      KIND_BADGE[d.kind] ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {KIND_LABEL[d.kind] ?? d.kind}
                  </span>
                  <span className="text-xs text-slate-400">{d.chunks} chunks</span>
                  <button
                    type="button"
                    onClick={() => deleteDoc(d.id, d.name)}
                    disabled={!!busy}
                    title="Delete this document"
                    className="ml-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
            {visibleDocs.length === 0 && (
              <li className="px-4 py-6 text-center text-slate-400">
                Nothing uploaded yet. Add your study material (notes, textbook or syllabus).
              </li>
            )}
          </ul>
        </Card>

        {/* 2. Topic map */}
        <Card id="topics">
          <StepTitle n={2} title="Topic map" />
          <button onClick={buildTopics} disabled={!effectiveSyllabus || !!busy} className={btn}>
            {topics.length
              ? "Rebuild topic map"
              : !syllabus && effectiveSyllabus
              ? "Build topic map from notes"
              : "Build topic map"}
          </button>
          {!effectiveSyllabus && (
            <p className="text-sm text-slate-400">Upload notes, a textbook, or a syllabus first.</p>
          )}
          {!syllabus && effectiveSyllabus && (
            <p className="rounded-lg bg-blue-50 p-2.5 text-xs text-blue-700">
              💡 <b>Auto-topic detection:</b> No separate syllabus uploaded. Using the Table of
              Contents / Chapter outline from <b>{effectiveSyllabus.name}</b>.
            </p>
          )}
          {topics.length > 0 && (
            <>
              <p className="text-sm text-slate-500">
                Tick the chapters you want to be tested on.
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

              {/* Question Count Selector & Generate Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 p-4 border border-slate-200">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700">
                    Questions per topic:
                  </label>
                  <select
                    value={perTopic}
                    onChange={(e) => setPerTopic(Number(e.target.value))}
                    disabled={!!busy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value={1}>1 question each ({selected.size} total)</option>
                    <option value={2}>2 questions each ({selected.size * 2} total)</option>
                    <option value={3}>3 questions each ({selected.size * 3} total)</option>
                    <option value={5}>5 questions each ({selected.size * 5} total)</option>
                  </select>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => generateQuiz(false)}
                    disabled={selected.size === 0 || !!busy}
                    className={btn}
                  >
                    Generate mixed quiz ({selected.size * perTopic} Qs)
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
              </div>
            </>
          )}
        </Card>

        {/* 3. Diagnostic quiz (Mixed across all topics!) */}
        {questions.length > 0 && (
          <Card id="quiz">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <StepTitle n={3} title="Diagnostic quiz" />
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                🔀 Mixed Mode ({questions.length} Questions)
              </span>
            </div>

            <div className="space-y-4">
              {questions.map((q, i) => (
                <div
                  key={q.id || `q-${i}`}
                  className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <span className="text-sm font-bold text-slate-800">
                      Question {i + 1} of {questions.length}
                    </span>
                    <span className="rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-800">
                      {q.topic}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap font-medium text-slate-900 leading-relaxed text-base">
                    {q.question}
                  </p>

                  <div className="space-y-2 pt-1">
                    {q.options.map((o, idx) => (
                      <label
                        key={idx}
                        className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition ${
                          answers[q.id] === idx
                            ? "border-blue-500 bg-blue-50/70 font-medium text-blue-900 shadow-xs"
                            : "border-slate-200 hover:bg-slate-50 text-slate-700"
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

                  <p className="text-xs text-slate-400 pt-1">
                    📖 Source: {q.citation.doc ?? "notes"}, page {q.citation.page ?? "?"}
                  </p>
                </div>
              ))}
            </div>

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
                <div
                  key={`${t.topicId || t.name}-${i}`}
                  className={`rounded-xl border p-4 ${STYLE[t.status]}`}
                >
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
                key={`${r.questionId || "res"}-${i}`}
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

        {/* 5. Revision plan */}
        {report && effectiveSyllabus && (
          <div id="plan" className="scroll-mt-6">
            <PlanSection key={`plan-${report.attemptId}`} syllabusDocId={effectiveSyllabus.id} />
          </div>
        )}

        {/* 6. Explain this topic */}
        {effectiveSyllabus && topics.length > 0 && (
          <ExplainSection topics={topics.map((t) => ({ id: t.id, name: t.name }))} />
        )}

        {/* 7. Progress dashboard */}
        {effectiveSyllabus && (
          <div id="progress" className="scroll-mt-6">
            <ProgressSection
              key={`progress-${report?.attemptId ?? "initial"}`}
              syllabusDocId={effectiveSyllabus.id}
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