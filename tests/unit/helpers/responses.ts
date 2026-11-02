/** Builds a model-output JSON string matching the response contract. */
export function contract(enhanced: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    enhanced_prompt: enhanced,
    changed: true,
    task_type: "other",
    techniques: [],
    missing_info: [],
    notes: "",
    ...extra,
  });
}

/** Builds a Groq chat-completions HTTP response. */
export function groqOk(content: string, finish = "stop"): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: finish }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function groqErr(status: number, message: string, headers: Record<string, string> = {}, code = ""): Response {
  return new Response(JSON.stringify({ error: { message, type: "error", code } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
