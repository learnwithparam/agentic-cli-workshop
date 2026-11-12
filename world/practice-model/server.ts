// The practice model: a small HTTP server that answers like a real model API, with no key and no cost.
// It speaks two shapes so any provider in config/models.ts can point at it:
//   POST /v1/messages          the Anthropic Messages API (plain JSON or a server-sent event stream)
//   POST /v1/chat/completions  the OpenAI chat completions shape (used by the openrouter and openai-compatible providers)
// Every request is recorded, so a check can read exactly what the learner's loop sent.
// What it answers comes from a scenario: a function from the request to the next turn.

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

export type Message = { role: "user" | "assistant"; blocks: Block[] };

export type Request = {
  api: "anthropic" | "openai";
  model: string;
  system: string;
  messages: Message[];
  tools: { name: string; description: string; schema: any }[];
  stream: boolean;
  raw: any;
  at: number;
};

export type Turn = {
  text?: string;
  tools?: { name: string; input: unknown; id?: string }[];
  usage?: { input: number; output: number };
  // Milliseconds between streamed chunks. Lets a check see whether output appears while the reply streams.
  chunkDelayMs?: number;
  // Send an HTTP error instead of a reply.
  status?: number;
  error?: string;
};

export type Scenario = (req: Request, all: Request[]) => Turn | Promise<Turn>;

export type PracticeModel = { url: string; port: number; requests: Request[]; stop: () => void };

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const textOf = (c: any): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p.text ?? "")).join("") : "";

// Read an Anthropic Messages request into the shared shape.
function fromAnthropic(body: any): Request {
  const system = typeof body.system === "string" ? body.system : textOf(body.system ?? []);
  const messages: Message[] = (body.messages ?? []).map((m: any) => ({
    role: m.role,
    blocks: (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content).flatMap((b: any): Block[] => {
      if (b.type === "text") return [{ type: "text", text: b.text }];
      if (b.type === "tool_use") return [{ type: "tool_use", id: b.id, name: b.name, input: b.input }];
      if (b.type === "tool_result")
        return [{ type: "tool_result", tool_use_id: b.tool_use_id, content: textOf(b.content), is_error: Boolean(b.is_error) }];
      return [];
    }),
  }));
  const tools = (body.tools ?? []).map((t: any) => ({ name: t.name, description: t.description ?? "", schema: t.input_schema }));
  return { api: "anthropic", model: body.model, system, messages, tools, stream: Boolean(body.stream), raw: body, at: Date.now() };
}

// Read an OpenAI chat completions request into the shared shape. Tool messages that follow each other
// become one user message, the way the Anthropic shape groups them.
function fromOpenAI(body: any): Request {
  let system = "";
  const messages: Message[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role && role === "user") last.blocks.push(...blocks);
    else messages.push({ role, blocks });
  };
  for (const m of body.messages ?? []) {
    if (m.role === "system" || m.role === "developer") system += textOf(m.content);
    else if (m.role === "user") push("user", [{ type: "text", text: textOf(m.content) }]);
    else if (m.role === "assistant") {
      const blocks: Block[] = [];
      const t = textOf(m.content ?? "");
      if (t) blocks.push({ type: "text", text: t });
      for (const c of m.tool_calls ?? [])
        blocks.push({ type: "tool_use", id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || "{}") });
      push("assistant", blocks);
    } else if (m.role === "tool") {
      const content = textOf(m.content);
      push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content, is_error: /^(error|Error)\b/.test(content) }]);
    }
  }
  const tools = (body.tools ?? []).map((t: any) => ({
    name: t.function?.name,
    description: t.function?.description ?? "",
    schema: t.function?.parameters,
  }));
  return { api: "openai", model: body.model, system, messages, tools, stream: Boolean(body.stream), raw: body, at: Date.now() };
}

const estimate = (s: string) => Math.max(1, Math.ceil(s.length / 4));

function usageFor(req: Request, turn: Turn) {
  if (turn.usage) return turn.usage;
  const input = estimate(JSON.stringify({ s: req.system, m: req.messages, t: req.tools }));
  const output = estimate((turn.text ?? "") + JSON.stringify(turn.tools ?? []));
  return { input, output };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunks(text: string, n = 6): string[] {
  if (!text) return [];
  const size = Math.max(1, Math.ceil(text.length / n));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function anthropicReply(req: Request, turn: Turn) {
  const tools = (turn.tools ?? []).map((t) => ({ type: "tool_use", id: t.id ?? newId("toolu"), name: t.name, input: t.input }));
  const content: any[] = [];
  if (turn.text) content.push({ type: "text", text: turn.text });
  content.push(...tools);
  const u = usageFor(req, turn);
  return {
    id: newId("msg"),
    type: "message",
    role: "assistant",
    model: req.model,
    content,
    stop_reason: tools.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: u.input, output_tokens: u.output },
  };
}

function anthropicStream(req: Request, turn: Turn): ReadableStream {
  const msg = anthropicReply(req, turn);
  const delay = turn.chunkDelayMs ?? 0;
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("message_start", {
        type: "message_start",
        message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: msg.usage.input_tokens, output_tokens: 1 } },
      });
      let index = 0;
      for (const block of msg.content) {
        if (block.type === "text") {
          send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
          for (const piece of chunks(block.text)) {
            if (delay) await sleep(delay);
            send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
          }
        } else {
          send("content_block_start", {
            type: "content_block_start",
            index,
            content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
          });
          if (delay) await sleep(delay);
          send("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
          });
        }
        send("content_block_stop", { type: "content_block_stop", index });
        index++;
      }
      send("message_delta", {
        type: "message_delta",
        delta: { stop_reason: msg.stop_reason, stop_sequence: null },
        usage: { output_tokens: msg.usage.output_tokens },
      });
      send("message_stop", { type: "message_stop" });
      ctrl.close();
    },
  });
}

function openaiReply(req: Request, turn: Turn) {
  const calls = (turn.tools ?? []).map((t) => ({
    id: t.id ?? newId("call"),
    type: "function",
    function: { name: t.name, arguments: JSON.stringify(t.input) },
  }));
  const u = usageFor(req, turn);
  return {
    id: newId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: req.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: turn.text ?? null, ...(calls.length ? { tool_calls: calls } : {}) },
        finish_reason: calls.length ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output },
  };
}

function openaiStream(req: Request, turn: Turn): ReadableStream {
  const r = openaiReply(req, turn);
  const delay = turn.chunkDelayMs ?? 0;
  const enc = new TextEncoder();
  const base = { id: r.id, object: "chat.completion.chunk", created: r.created, model: r.model };
  return new ReadableStream({
    async start(ctrl) {
      const send = (d: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`));
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
      for (const piece of chunks(turn.text ?? "")) {
        if (delay) await sleep(delay);
        send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
      }
      const calls = (r.choices[0].message as any).tool_calls ?? [];
      calls.forEach((c: any, i: number) =>
        send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, ...c }] }, finish_reason: null }] }),
      );
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: r.choices[0].finish_reason }], usage: r.usage });
      ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
      ctrl.close();
    },
  });
}

// maxRequests protects a laptop from a loop with no stop rule: past it, every call gets an error.
export type Options = { scenario: Scenario; port?: number; onRequest?: (r: Request) => void; maxRequests?: number };

export function startPracticeModel({ scenario, port = 0, onRequest, maxRequests = 200 }: Options): PracticeModel {
  const requests: Request[] = [];
  const server = Bun.serve({
    port,
    idleTimeout: 120,
    async fetch(httpReq) {
      const url = new URL(httpReq.url);
      if (httpReq.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });
      if (httpReq.method === "GET" && url.pathname === "/requests") return Response.json(requests);
      const isAnthropic = url.pathname.endsWith("/messages");
      const isOpenAI = url.pathname.endsWith("/chat/completions");
      if (httpReq.method !== "POST" || (!isAnthropic && !isOpenAI))
        return Response.json({ error: { message: `The practice model does not serve ${httpReq.method} ${url.pathname}` } }, { status: 404 });
      if (requests.length >= maxRequests) {
        const message = `The practice model stopped answering after ${maxRequests} calls in one run. Your loop has no stop rule.`;
        return Response.json(isAnthropic ? { type: "error", error: { type: "rate_limit_error", message } } : { error: { message } }, { status: 400 });
      }
      const body = await httpReq.json();
      const req = isAnthropic ? fromAnthropic(body) : fromOpenAI(body);
      requests.push(req);
      onRequest?.(req);
      let turn: Turn;
      try {
        turn = await scenario(req, requests);
      } catch (e) {
        turn = { status: 500, error: `The practice model scenario failed: ${(e as Error).message}` };
      }
      if (turn.status) {
        const err = isAnthropic
          ? { type: "error", error: { type: "invalid_request_error", message: turn.error ?? "error" } }
          : { error: { message: turn.error ?? "error", type: "invalid_request_error" } };
        return Response.json(err, { status: turn.status });
      }
      if (req.stream) {
        const stream = isAnthropic ? anthropicStream(req, turn) : openaiStream(req, turn);
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }
      return Response.json(isAnthropic ? anthropicReply(req, turn) : openaiReply(req, turn));
    },
  });
  return { url: `http://localhost:${server.port}`, port: server.port!, requests, stop: () => server.stop(true) };
}

// Helpers scenarios use to read the conversation.
export const lastUser = (req: Request) => [...req.messages].reverse().find((m) => m.role === "user");
export const toolResults = (req: Request) => req.messages.flatMap((m) => m.blocks.filter((b) => b.type === "tool_result")) as Extract<Block, { type: "tool_result" }>[];
export const toolUses = (req: Request) => req.messages.flatMap((m) => m.blocks.filter((b) => b.type === "tool_use")) as Extract<Block, { type: "tool_use" }>[];
export const userText = (req: Request) =>
  req.messages
    .filter((m) => m.role === "user")
    .flatMap((m) => m.blocks)
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("\n");
