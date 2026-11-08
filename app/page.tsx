"use client";
import { useCallback, useEffect, useState } from "react";
import PlanSection from "./PlanSection";
import ExplainSection from "./ExplainSection";
import ProgressSection from "./ProgressSection";

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
  weak: "border-red-400 bg-red-100 text-red-900",
  medium: "border-yellow-400 bg-yellow-100 text-yellow-900",
  strong: "border-green-400 bg-green-100 text-green-900",
};
const LABEL: Record<Status, string> = {
  weak: "🔴 Weak",
  medium: "🟡 Medium",
  strong: "🟢 Strong",
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function Home() {
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

  const syllabus = docs.find((d) => d.kind === "syllabus");
  const paper = docs.find((d) => d.kind === "past_paper");

  // Used after an upload to refresh the document list
  const loadDocs = useCallback(async () => {
    const res = await fetch("/api/documents");
    if (res.ok) setDocs(await res.json());
  }, []);

  // Load documents once when the page opens
  useEffect(() => {
    let cancelled = false;
    fetch("/api/documents")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled) setDocs(d);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load saved topic map for the syllabus
  useEffect(() => {
    if (!syllabus?.id) return;
    fetch(`/api/topics?syllabusDocId=${syllabus.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.topics?.length) {
          setTopics(d.topics);
          setSelected(new Set(d.topics.map((t: Topic) => t.id)));
        }
      });
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
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      await loadDocs();
      form.reset();
    });
  }

  async function buildTopics() {
    if (!syllabus) return;
    const data = await run("Building topic map...", () =>
      post("/api/topics", { syllabusDocId: syllabus.id, pastPaperDocId: paper?.id })
    );
    if (data) {
      setTopics(data.topics);
      setSelected(new Set(data.topics.map((t: Topic) => t.id)));
      setQuestions([]);
      setReport(null);
    }
  }

  async function generateQuiz() {
    if (!syllabus) return;
    const data = await run("Generating quiz from your material...", () =>
      post("/api/quiz", {
        syllabusDocId: syllabus.id,
        topicIds: Array.from(selected),
        perTopic: 3,
      })
    );
    if (data) {
      setQuestions(data.questions);
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

  const input = "border p-2 bg-white text-black";
  const btn = "rounded bg-black px-4 py-2 text-white disabled:opacity-40";

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-3xl font-bold">GapFinder AI</h1>
        <p className="text-sm opacity-70">
          Upload → Topic map → Diagnostic quiz → Gap report → Revision plan
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-400 bg-red-100 p-3 text-sm text-red-900">
          {error}
        </div>
      )}
      {busy && (
        <div className="rounded border p-3 text-sm">⏳ {busy} (can take up to a minute)</div>
      )}

      {/* 1. Upload */}
      <section className="space-y-3 rounded border p-4">
        <h2 className="text-xl font-semibold">1. Upload study material</h2>
        <form onSubmit={onUpload} className="flex flex-col gap-3 sm:flex-row">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            <option value="syllabus">Syllabus</option>
            <option value="notes">Notes / Textbook</option>
            <option value="past_paper">Past paper</option>
          </select>
          <input type="file" name="file" accept=".pdf,.txt" required className="border p-2" />
          <button disabled={!!busy} className={btn}>
            Upload
          </button>
        </form>
        <ul className="text-sm">
          {docs.map((d) => (
            <li key={d.id}>
              📄 {d.name}{" "}
              <span className="opacity-60">
                ({d.kind}, {d.chunks} chunks)
              </span>
            </li>
          ))}
          {docs.length === 0 && <li className="opacity-60">Nothing uploaded yet.</li>}
        </ul>
      </section>

      {/* 2. Topic map */}
      <section className="space-y-3 rounded border p-4">
        <h2 className="text-xl font-semibold">2. Topic map</h2>
        <button onClick={buildTopics} disabled={!syllabus || !!busy} className={btn}>
          {topics.length ? "Rebuild topic map" : "Build topic map"}
        </button>
        {!syllabus && <p className="text-sm opacity-60">Upload a syllabus first.</p>}
        {topics.length > 0 && (
          <>
            <p className="text-sm opacity-70">
              Tick the chapters you want to be tested on (only chapters whose notes you
              uploaded will get questions).
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-1">Test</th>
                  <th className="p-1">Topic</th>
                  <th className="p-1">Subtopics</th>
                  <th className="p-1">In past paper</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="p-1">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                      />
                    </td>
                    <td className="p-1">{t.name}</td>
                    <td className="p-1">{t.subtopics?.length ?? 0}</td>
                    <td className="p-1">{t.exam_count} Qs</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={generateQuiz}
              disabled={selected.size === 0 || !!busy}
              className={btn}
            >
              Generate diagnostic quiz
            </button>
          </>
        )}
      </section>

      {/* 3. Quiz */}
      {questions.length > 0 && (
        <section className="space-y-4 rounded border p-4">
          <h2 className="text-xl font-semibold">3. Diagnostic quiz</h2>
          {Object.entries(grouped).map(([topic, qs]) => (
            <div key={topic} className="space-y-3">
              <h3 className="font-semibold">{topic}</h3>
              {qs.map((q, i) => (
                <div key={q.id} className="space-y-1 rounded border p-3">
                  <p className="whitespace-pre-wrap">
                    {i + 1}. {q.question}
                  </p>
                  {q.options.map((o, idx) => (
                    <label key={idx} className="flex gap-2 text-sm">
                      <input
                        type="radio"
                        name={q.id}
                        disabled={!!report}
                        checked={answers[q.id] === idx}
                        onChange={() => setAnswers({ ...answers, [q.id]: idx })}
                      />
                      {o}
                    </label>
                  ))}
                  <p className="text-xs opacity-60">
                    📖 Source: {q.citation.doc ?? "notes"}, page {q.citation.page ?? "?"}
                  </p>
                </div>
              ))}
            </div>
          ))}
          {skipped.length > 0 && (
            <details className="text-xs opacity-70">
              <summary>Skipped topics ({skipped.length})</summary>
              <ul>
                {skipped.map((s) => (
                  <li key={s.topic}>
                    {s.topic}: {s.reason}
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
        </section>
      )}

      {/* 4. Gap report */}
      {report && (
        <section className="space-y-4 rounded border p-4">
          <h2 className="text-xl font-semibold">4. Gap report</h2>
          <p className="text-lg">
            Overall score: <b>{report.scorePct}%</b>
          </p>
          <div className="space-y-2">
            {report.topics.map((t) => (
              <div key={t.topicId} className={`rounded border p-3 ${STYLE[t.status]}`}>
                <div className="flex justify-between font-semibold">
                  <span>
                    {LABEL[t.status]} · {t.name}
                  </span>
                  <span>
                    {t.correct}/{t.total} ({t.pct}%)
                  </span>
                </div>
                <p className="text-sm">{t.reason}</p>
                <p className="text-xs opacity-70">
                  Appears in past paper: {t.examCount} question(s)
                </p>
              </div>
            ))}
          </div>

          <h3 className="font-semibold">Answer review</h3>
          {report.results.map((r) => (
            <div key={r.questionId} className="space-y-1 rounded border p-3 text-sm">
              <p className="whitespace-pre-wrap">
                {r.isCorrect ? "✅" : "❌"} {r.question}
              </p>
              {!r.isCorrect && (
                <p>
                  Your answer:{" "}
                  {r.chosenIndex !== null ? r.options[r.chosenIndex] : "(not answered)"} —{" "}
                  {r.explanation}
                </p>
              )}
              <p>
                Correct: {r.options[r.correctIndex]} — {r.correctExplanation}
              </p>
              <p className="text-xs opacity-60">
                📖 {r.citation.doc ?? "notes"}, page {r.citation.page ?? "?"}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* 5. Revision plan (rebuilds after every new attempt) */}
      {report && syllabus && (
        <PlanSection key={report.attemptId} syllabusDocId={syllabus.id} />
      )}
            {syllabus && topics.length > 0 && (
        <ExplainSection topics={topics.map((t) => ({ id: t.id, name: t.name }))} />
      )}

      {syllabus && (
        <ProgressSection key={report?.attemptId ?? "initial"} syllabusDocId={syllabus.id} />
      )}
    </main>
  );
}