import { z } from "zod";

// The 2 authorized models on this Groq organization
const PRIMARY_MODEL = "openai/gpt-oss-120b";
const FALLBACK_MODEL = "openai/gpt-oss-20b";

function getActiveModel(): string {
  const envModel = process.env.GROQ_MODEL;
  // If env has llama or gpt-oss-20b, prefer gpt-oss-120b which has fresh quota
  if (!envModel || envModel.includes("llama") || envModel.includes("gpt-oss-20b")) {
    return PRIMARY_MODEL;
  }
  return envModel;
}

export async function askJSON<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  let lastErr = "";
  let currentModel = getActiveModel();

  for (let attempt = 0; attempt < 2; attempt++) {
    const makeBody = (model: string): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model,
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
      if (model.startsWith("openai/gpt-oss")) {
        body.reasoning_effort = "low";
      }
      return body;
    };

    let res = await callGroq(makeBody(currentModel));

    // If 429 (Rate limit) or 404, switch between the 2 authorized models
    if ((res.status === 429 || res.status === 404) && currentModel !== FALLBACK_MODEL) {
      console.warn(`[Groq] ${currentModel} returned ${res.status}. Switching to fallback: ${FALLBACK_MODEL}`);
      currentModel = FALLBACK_MODEL;
      res = await callGroq(makeBody(currentModel));
    }

    // Quick wait (max 2 seconds) if needed
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 3);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await callGroq(makeBody(currentModel));
    }

    if (!res.ok) {
      const errText = await res.text();
      if (currentModel !== FALLBACK_MODEL) {
        currentModel = FALLBACK_MODEL;
        res = await callGroq(makeBody(currentModel));
      }
      if (!res.ok) {
        throw new Error(`Groq error ${res.status}: ${errText.slice(0, 300)}`);
      }
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