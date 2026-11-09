import { z } from "zod";

// Fast and high-performance default model on Groq
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export async function askJSON<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  let lastErr = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const body: Record<string, unknown> = {
      model: MODEL,
      temperature: opts.temperature ?? 0.2,
      max_completion_tokens: opts.maxTokens ?? 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: opts.system + "\nRespond with a single valid JSON object only.",
        },
        {
          role: "user",
          content:
            opts.user +
            (lastErr ? `\n\nYour previous reply was invalid (${lastErr}). Fix it.` : ""),
        },
      ],
    };

    // Call Groq with safe quick retries (capped at 3s so Vercel never hits 504)
    let res = await callGroq(body);
    for (let i = 0; i < 2 && res.status === 429; i++) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 4);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await callGroq(body);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.message.slice(0, 300);
    } catch {
      lastErr = "not valid JSON: " + text.slice(0, 100);
    }
  }

  throw new Error("LLM returned invalid output: " + lastErr);
}

function callGroq(body: Record<string, unknown>) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}