import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";

export const maxDuration = 60;

const TipsSchema = z.object({
  tips: z.array(z.object({ topic: z.string(), tip: z.string() })),
});

type Status = "weak" | "medium" | "strong";
const statusOf = (pct: number): Status => (pct < 40 ? "weak" : pct < 70 ? "medium" : "strong");

type WrongQ = {
  id: string;
  question: string;
  subtopic: string | null;
  source_doc_name: string | null;
  source_page: number | null;
};

export async function POST(req: Request) {
  const body = await req.json();
  const syllabusDocId: string = body.syllabusDocId;
  const days = Math.min(Math.max(Number(body.days) || 5, 1), 30);
  const hoursPerDay = Math.min(Math.max(Number(body.hoursPerDay) || 2, 0.5), 12);
  if (!syllabusDocId) {
    return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
  }

  try {
    const { data: attempts } = await supabase
      .from("attempts")
      .select("id")
      .eq("syllabus_doc_id", syllabusDocId)
      .order("created_at", { ascending: false });
    if (!attempts || attempts.length === 0) {
      return NextResponse.json({ error: "Take a diagnostic quiz first" }, { status: 400 });
    }
    const rank = new Map<string, number>(attempts.map((a, i) => [a.id as string, i]));

    const { data: ans } = await supabase
      .from("attempt_answers")
      .select("attempt_id,topic_id,question_id,is_correct")
      .in("attempt_id", attempts.map((a) => a.id));

    // For every topic, use only its MOST RECENT attempt
    const latest = new Map<string, number>();
    for (const r of ans ?? []) {
      const rk = rank.get(r.attempt_id) ?? 0;
      const cur = latest.get(r.topic_id);
      if (cur === undefined || rk < cur) latest.set(r.topic_id, rk);
    }
    const stats = new Map<string, { total: number; correct: number; wrongIds: string[] }>();
    for (const r of ans ?? []) {
      if ((rank.get(r.attempt_id) ?? 0) !== latest.get(r.topic_id)) continue;
      const s = stats.get(r.topic_id) ?? { total: 0, correct: 0, wrongIds: [] };
      s.total += 1;
      if (r.is_correct) s.correct += 1;
      else s.wrongIds.push(r.question_id);
      stats.set(r.topic_id, s);
    }

    const { data: topics } = await supabase
      .from("topics")
      .select("id,name,exam_count")
      .eq("syllabus_doc_id", syllabusDocId);

    const items = (topics ?? [])
      .filter((t) => stats.has(t.id))
      .map((t) => {
        const s = stats.get(t.id)!;
        const pct = Math.round((100 * s.correct) / s.total);
        const examCount = (t.exam_count ?? 0) as number;
        return {
          name: t.name as string,
          pct,
          status: statusOf(pct),
          examCount,
          wrongIds: s.wrongIds,
          priority: ((100 - pct) / 100) * (1 + examCount),
          minutes: 0,
          sources: [] as string[],
          tip: "",
        };
      })
      .filter((t) => t.status !== "strong")
      .sort((a, b) => b.priority - a.priority);

    if (items.length === 0) {
      return NextResponse.json({
        days: [],
        topics: [],
        message: "No weak or medium topics. Great job! Take another quiz to confirm.",
      });
    }

    // Where to revise: sources of the questions the student missed
    const allWrong = items.flatMap((i) => i.wrongIds);
    let wq: WrongQ[] = [];
    if (allWrong.length > 0) {
      const { data } = await supabase
        .from("questions")
        .select("id,question,subtopic,source_doc_name,source_page")
        .in("id", allWrong);
      wq = data ?? [];
    }
    const qMap = new Map(wq.map((q) => [q.id, q]));
    for (const it of items) {
      const set = new Set<string>();
      for (const id of it.wrongIds) {
        const q = qMap.get(id);
        if (q?.source_doc_name) set.add(`${q.source_doc_name}, page ${q.source_page}`);
      }
      it.sources = Array.from(set);
    }

    // Time allocation + day-wise schedule: plain code, no LLM
    const totalMin = Math.round(days * hoursPerDay * 60);
    const sumW = items.reduce((s, i) => s + i.priority, 0);
    for (const it of items) {
      it.minutes = Math.max(15, Math.round((totalMin * it.priority) / sumW / 5) * 5);
    }
    let over = items.reduce((s, i) => s + i.minutes, 0) - totalMin;
    for (let i = items.length - 1; over > 0 && i >= 0; i--) {
      const cut = Math.min(over, items[i].minutes - 15);
      if (cut > 0) {
        items[i].minutes -= cut;
        over -= cut;
      }
    }

    const cap = Math.round(hoursPerDay * 60);
    const schedule = Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      used: 0,
      sessions: [] as { topic: string; minutes: number; status: Status }[],
    }));
    let d = 0;
    for (const it of items) {
      let left = it.minutes;
      while (left > 0 && d < days) {
        const room = cap - schedule[d].used;
        if (room <= 0) {
          d++;
          continue;
        }
        const m = Math.min(room, left);
        schedule[d].sessions.push({ topic: it.name, minutes: m, status: it.status });
        schedule[d].used += m;
        left -= m;
      }
    }

    // LLM only writes short study tips from the missed concepts
    try {
      const payload = items.map((it) => ({
        topic: it.name,
        score: `${it.pct}%`,
        missed: it.wrongIds
          .map((id) => qMap.get(id)?.subtopic || qMap.get(id)?.question?.slice(0, 80))
          .filter(Boolean),
        material: it.sources,
      }));
      const out = await askJSON({
        system: "You are a study coach. Use only the data given. Do not invent facts.",
        user: `Student weak topics:\n${JSON.stringify(payload)}\n\nFor each topic write ONE practical study tip (max 35 words) that mentions the material to re-read (file and page) and the missed concept.\nReturn JSON: {"tips":[{"topic":"<exact topic name>","tip":"..."}]}`,
        schema: TipsSchema,
      });
      const m = new Map(out.tips.map((t) => [t.topic.toLowerCase().trim(), t.tip]));
      for (const it of items) it.tip = m.get(it.name.toLowerCase().trim()) ?? "";
    } catch {
      // fallback tips below
    }
    for (const it of items) {
      if (!it.tip) {
        it.tip = it.sources.length
          ? `Re-read ${it.sources[0]}, then redo the questions you missed.`
          : "Re-read this chapter and redo the questions you missed.";
      }
    }

    return NextResponse.json({
      days: schedule,
      topics: items.map((it) => ({
        name: it.name,
        pct: it.pct,
        status: it.status,
        minutes: it.minutes,
        examCount: it.examCount,
        sources: it.sources,
        tip: it.tip,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}