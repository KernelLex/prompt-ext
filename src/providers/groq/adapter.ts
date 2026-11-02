import type { ProviderRequest } from "../../engine/types";
import { ProviderError } from "../errors";
import type { ProviderAdapter, ProviderCallContext } from "../types";
import {
  GROQ_BASE_URL, GROQ_DEFAULT_MODEL, GROQ_HOST_PERMISSION, GROQ_MODELS, REASONING_HEADROOM_TOKENS, REQUEST_TIMEOUT_MS,
} from "./config";

/** Parses Groq's "retry-after" (seconds) or "x-ratelimit-reset-*" ("2m59.56s", "7.66s", "120ms"). */
export function parseRetryHint(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim())) return Math.ceil(parseFloat(retryAfter) * 1000);
  const reset = headers.get("x-ratelimit-reset-requests") ?? headers.get("x-ratelimit-reset-tokens");
  if (!reset) return undefined;
  let ms = 0;
  let matched = false;
  for (const m of reset.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = parseFloat(m[1] ?? "0");
    ms += m[2] === "h" ? n * 3_600_000 : m[2] === "m" ? n * 60_000 : m[2] === "s" ? n * 1000 : n;
  }
  return matched ? Math.ceil(ms) : undefined;
}

async function readErrorMessage(res: Response): Promise<{ message: string; code: string }> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown; code?: unknown; type?: unknown } };
    return {
      message: typeof body.error?.message === "string" ? body.error.message : `HTTP ${res.status}`,
      code: typeof body.error?.code === "string" ? body.error.code : typeof body.error?.type === "string" ? body.error.type : "",
    };
  } catch {
    return { message: `HTTP ${res.status}`, code: "" };
  }
}

/** Maps a Groq HTTP error onto the shared taxonomy. */
export async function mapGroqError(res: Response): Promise<ProviderError> {
  const { message, code } = await readErrorMessage(res);
  const info = { status: res.status, retryAfterMs: parseRetryHint(res.headers) };
  switch (res.status) {
    case 401:
      return new ProviderError("auth", message, info);
    case 403:
      return new ProviderError("forbidden", message, info);
    case 404:
      return new ProviderError("model_unavailable", message, info);
    case 413:
      return new ProviderError("invalid_request", "The prompt is too large for this model.", info);
    case 429: {
      const daily = /per day|\(RPD\)|\(TPD\)|daily|quota/i.test(message);
      return new ProviderError(daily ? "quota_exhausted" : "rate_limited", message, info);
    }
    case 400:
      if (code === "json_validate_failed") return new ProviderError("malformed_response", "The model produced invalid JSON.", info);
      if (/model.*(not found|does not exist|decommissioned)/i.test(message)) return new ProviderError("model_unavailable", message, info);
      return new ProviderError("invalid_request", message, info);
    default:
      if (res.status >= 500) return new ProviderError("server", message, info);
      return new ProviderError("invalid_request", message, info);
  }
}

function withTimeout(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw ProviderError.from(err);
  }
}

export function createGroqAdapter(baseUrl: string = GROQ_BASE_URL): ProviderAdapter {
  return {
    id: "groq",
    displayName: "Groq",
    hostPermission: baseUrl === GROQ_BASE_URL ? GROQ_HOST_PERMISSION : `${new URL(baseUrl).origin}/*`,
    models: GROQ_MODELS,
    defaultModel: GROQ_DEFAULT_MODEL,

    async complete(request: ProviderRequest, ctx: ProviderCallContext): Promise<string> {
      const model = GROQ_MODELS.find((m) => m.id === ctx.model);
      const reasoning = model?.reasoning ?? false;
      const body: Record<string, unknown> = {
        model: ctx.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: request.temperature,
        max_completion_tokens: request.maxOutputTokens + (reasoning ? REASONING_HEADROOM_TOKENS : 0),
        response_format: { type: "json_object" },
        stream: false,
      };
      if (reasoning) body.reasoning_effort = "low";

      const res = await send(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.apiKey}` },
        body: JSON.stringify(body),
        signal: withTimeout(ctx.signal),
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) throw await mapGroqError(res);

      let data: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> };
      try {
        data = await res.json();
      } catch {
        throw new ProviderError("malformed_response", "Response body was not JSON.");
      }
      const choice = data.choices?.[0];
      if (choice?.finish_reason === "length") throw new ProviderError("malformed_response", "The response was cut off (length limit).");
      const content = choice?.message?.content;
      if (typeof content !== "string" || content.trim() === "") throw new ProviderError("malformed_response", "Response had no content.");
      return content;
    },

    async listModels(ctx): Promise<string[]> {
      const res = await send(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        signal: withTimeout(ctx.signal),
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) throw await mapGroqError(res);
      const data = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> };
      return (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    },
  };
}
