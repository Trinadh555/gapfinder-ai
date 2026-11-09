"use client";
import { useState } from "react";
import { authFetch } from "@/lib/authFetch";

type Source = { n: number; doc: string; page: number };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };

// Cleans up any accidental LaTeX slashes into clean, readable math
function cleanMathText(text: string): string {
  if (!text) return "";
  return text
    // Replace LaTeX brackets
    .replace(/\\\[\s*/g, "\n")
    .replace(/\s*\\\]/g, "\n")
    .replace(/\\\(\s*/g, "")
    .replace(/\s*\\\)/g, "")
    // Replace common LaTeX symbols
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1 / $2)")
    .replace(/\\sigma/g, "σ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\theta/g, "θ")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\approx/g, "≈")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\,/g, " ");
}

export default function ExplainSection({
  topics,
}: {
  topics: { id: string; name: string }[];
}) {
  const [topic, setTopic] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setError("");

    try {
      const res = await authFetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Request failed");
      }

      let sources: Source[] = [];
      try {
        sources = JSON.parse(decodeURIComponent(res.headers.get("X-Sources") ?? "[]"));
      } catch {
        sources = [];
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let chunk = await reader.read();
      while (!chunk.done) {
        acc += decoder.decode(chunk.value, { stream: true });
        setMessages([...history, { role: "assistant", content: acc, sources }]);
        chunk = await reader.read();
      }

      if (!acc.trim()) {
        setMessages([
          ...history,
          {
            role: "assistant",
            content:
              "The AI is busy right now (free-tier limit). Please wait about 15 seconds and ask again.",
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(history);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          6
        </span>
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Explain this topic</h2>
          <p className="text-sm text-slate-500">
            Answers come only from your uploaded notes, with page citations.
          </p>
        </div>
      </div>

      <select
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      >
        <option value="">Any topic</option>
        {topics.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>

      {messages.length > 0 && (
        <div className="max-h-112 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === "user"
                    ? "rounded-br-sm bg-indigo-600 text-white"
                    : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                }`}
              >
                <p
                  className={`mb-1 text-xs font-semibold ${
                    m.role === "user" ? "text-indigo-200" : "text-slate-400"
                  }`}
                >
                  {m.role === "user" ? "You" : "Tutor"}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {cleanMathText(m.content) || "..."}
                </p>
                {m.sources && m.sources.length > 0 && m.content && (
                  <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-400">
                    📖 Sources:{" "}
                    {m.sources.map((s) => `[${s.n}] ${s.doc}, p.${s.page}`).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What is the transpose of a matrix? / What is sigmoid function?"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "..." : "Ask"}
        </button>
      </form>
    </section>
  );
}