"use client";
import { useState } from "react";
import { authFetch } from "@/lib/authFetch";

type Source = { n: number; doc: string; page: number };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(history);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="text-xl font-semibold">6. Explain this topic</h2>
      <p className="text-sm opacity-70">
        Answers come only from your uploaded notes, with page citations.
      </p>

      <select
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        className="border bg-white p-2 text-black"
      >
        <option value="">Any topic</option>
        {topics.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>

      <div className="space-y-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded border p-3 text-sm ${m.role === "user" ? "bg-gray-100 text-black" : ""}`}
          >
            <p className="mb-1 text-xs font-semibold opacity-60">
              {m.role === "user" ? "You" : "Tutor"}
            </p>
            <p className="whitespace-pre-wrap">{m.content || "..."}</p>
            {m.sources && m.sources.length > 0 && m.content && (
              <p className="mt-2 text-xs opacity-60">
                📖 Sources:{" "}
                {m.sources.map((s) => `[${s.n}] ${s.doc}, p.${s.page}`).join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-400 bg-red-100 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What is the transpose of a matrix? / important questions on matrices"
          className="flex-1 border bg-white p-2 text-black"
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
        >
          {busy ? "..." : "Ask"}
        </button>
      </form>
    </section>
  );
}