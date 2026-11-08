"use client";
import { useState } from "react";

export default function Home() {
  const [kind, setKind] = useState("notes");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    fd.set("kind", kind);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setResult(JSON.stringify(await res.json(), null, 2));
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-4 text-2xl font-bold">GapFinder AI</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="border p-2">
          <option value="syllabus">Syllabus</option>
          <option value="notes">Notes / Textbook</option>
          <option value="past_paper">Past paper</option>
        </select>
        <input type="file" name="file" accept=".pdf,.txt" required className="border p-2" />
        <button disabled={loading} className="bg-black p-2 text-white">
          {loading ? "Uploading..." : "Upload"}
        </button>
      </form>
      <pre className="mt-4 whitespace-pre-wrap text-sm">{result}</pre>
    </main>
  );
}