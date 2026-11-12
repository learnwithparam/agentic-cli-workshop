// The practice model: a small HTTP server that answers like a real model API, with no key and
// no cost. It speaks two shapes so any provider in config/models.ts can point at it:
//   POST /v1/messages          the Anthropic Messages API (plain JSON or a server-sent event
//                              stream)
//   POST /v1/chat/completions  the OpenAI chat completions shape (used by the openrouter and
//                              openai-compatible providers)
// Every request is recorded, so a check can read exactly what the learner's loop sent.
// What it answers comes from a scenario: a function from the request to the next turn.

// The shared shape both APIs are read into. Field names like tool_use_id follow the
// Anthropic Messages API, because checks compare them with what the learner's loop sent.
// biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };
// biome-ignore-end lint/style/useNamingConvention: back to our own names

export type TextBlock = Extract<Block, { type: "text" }>;
export type ToolUseBlock = Extract<Block, { type: "tool_use" }>;
export type ToolResultBlock = Extract<Block, { type: "tool_result" }>;

export type Message = { role: "user" | "assistant"; blocks: Block[] };

// A JSON Schema, as a tool describes its input. Only the parts the checks read are named.
export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  [field: string]: unknown;
};

export type Request = {
  api: "anthropic" | "openai";
  model: string;
  system: string;
  messages: Message[];
  tools: { name: string; description: string; schema: JsonSchema | undefined }[];
  stream: boolean;
  // The request body exactly as it arrived, for checks that look at other settings.
  raw: Record<string, unknown>;
  at: number;
};

export type Turn = {
  text?: string;
  tools?: { name: string; input: unknown; id?: string }[];
  usage?: { input: number; output: number };
  // Milliseconds between streamed chunks. Lets a check see whether output appears while the
  // reply streams.
  chunkDelayMs?: number;
  // Send an HTTP error instead of a reply.
  status?: number;
  error?: string;
};

export type Scenario = (request: Request, allRequests: Request[]) => Turn | Promise<Turn>;

export type PracticeModel = { url: string; port: number; requests: Request[]; stop: () => void };

// What the two APIs send us, as far as the practice model reads it.
// biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
type AnthropicBlockIn = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: unknown;
};
type AnthropicBody = {
  model: string;
  system?: unknown;
  messages?: { role: "user" | "assistant"; content: string | AnthropicBlockIn[] }[];
  tools?: { name: string; description?: string; input_schema?: JsonSchema }[];
  stream?: unknown;
};
type OpenAiToolCall = { id: string; function: { name: string; arguments?: string } };
type OpenAiMessage = {
  role: string;
  content?: unknown;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};
type OpenAiBody = {
  model: string;
  messages?: OpenAiMessage[];
  tools?: { function?: { name?: string; description?: string; parameters?: JsonSchema } }[];
  stream?: unknown;
};
// biome-ignore-end lint/style/useNamingConvention: back to our own names

let idCounter = 0;
// An id like a real API's: unique within a run, with a prefix that says what it names.
function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const count = (idCounter++).toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${count}${randomPart}`;
}

// Text can arrive as a plain string or as a list of parts, each a string or { text }.
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(textOfPart).join("");
}

function textOfPart(part: unknown): string {
  if (typeof part === "string") return part;
  return (part as { text?: string }).text ?? "";
}

// Reading requests into the shared shape.

function readAnthropicBlock(block: AnthropicBlockIn): Block[] {
  if (block.type === "text") return [{ type: "text", text: block.text } as TextBlock];
  if (block.type === "tool_use") {
    return [
      { type: "tool_use", id: block.id, name: block.name, input: block.input } as ToolUseBlock,
    ];
  }
  if (block.type === "tool_result") {
    return [
      {
        type: "tool_result",
        // biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
        tool_use_id: block.tool_use_id,
        content: textOf(block.content),
        is_error: Boolean(block.is_error),
        // biome-ignore-end lint/style/useNamingConvention: back to our own names
      } as ToolResultBlock,
    ];
  }
  // Other kinds of block, such as thinking, are not part of the shared shape.
  return [];
}

function fromAnthropic(body: AnthropicBody): Request {
  const messages: Message[] = (body.messages ?? []).map((message) => {
    let blocks = message.content;
    if (typeof blocks === "string") blocks = [{ type: "text", text: blocks }];
    return { role: message.role, blocks: blocks.flatMap(readAnthropicBlock) };
  });
  const tools = (body.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    schema: tool.input_schema,
  }));
  return {
    api: "anthropic",
    model: body.model,
    system: textOf(body.system),
    messages,
    tools,
    stream: Boolean(body.stream),
    raw: body,
    at: Date.now(),
  };
}

// Tool results that follow each other become one user message, the way the Anthropic shape
// groups them.
function addMessage(messages: Message[], role: Message["role"], blocks: Block[]): void {
  const last = messages[messages.length - 1];
  if (last && last.role === role && role === "user") last.blocks.push(...blocks);
  else messages.push({ role, blocks });
}

function openAiAssistantBlocks(message: OpenAiMessage): Block[] {
  const blocks: Block[] = [];
  const text = textOf(message.content);
  if (text) blocks.push({ type: "text", text });
  for (const call of message.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: JSON.parse(call.function.arguments || "{}"),
    });
  }
  return blocks;
}

function openAiToolResult(message: OpenAiMessage): ToolResultBlock {
  const content = textOf(message.content);
  return {
    type: "tool_result",
    // biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
    tool_use_id: message.tool_call_id as string,
    content,
    // The OpenAI shape has no error flag, so a result that starts with "Error" counts as one.
    is_error: /^(error|Error)\b/.test(content),
    // biome-ignore-end lint/style/useNamingConvention: back to our own names
  };
}

type Conversation = { system: string; messages: Message[] };

function readOpenAiMessage(conversation: Conversation, message: OpenAiMessage): void {
  const { role } = message;
  if (role === "system" || role === "developer") conversation.system += textOf(message.content);
  if (role === "user") {
    addMessage(conversation.messages, "user", [{ type: "text", text: textOf(message.content) }]);
  }
  if (role === "assistant") {
    addMessage(conversation.messages, "assistant", openAiAssistantBlocks(message));
  }
  if (role === "tool") addMessage(conversation.messages, "user", [openAiToolResult(message)]);
}

function fromOpenAi(body: OpenAiBody): Request {
  const conversation: Conversation = { system: "", messages: [] };
  for (const message of body.messages ?? []) readOpenAiMessage(conversation, message);
  const { system, messages } = conversation;
  const tools = (body.tools ?? []).map((tool) => ({
    name: tool.function?.name as string,
    description: tool.function?.description ?? "",
    schema: tool.function?.parameters,
  }));
  return {
    api: "openai",
    model: body.model,
    system,
    messages,
    tools,
    stream: Boolean(body.stream),
    raw: body,
    at: Date.now(),
  };
}

// Writing replies.

// A rough token count: about four characters to a token, and never zero.
const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

function usageFor(request: Request, turn: Turn) {
  if (turn.usage) return turn.usage;
  // The one-letter keys keep the estimate the same as it has always been.
  const everythingSent = JSON.stringify({
    s: request.system,
    m: request.messages,
    t: request.tools,
  });
  const input = estimateTokens(everythingSent);
  const output = estimateTokens((turn.text ?? "") + JSON.stringify(turn.tools ?? []));
  return { input, output };
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Split text into about `pieceCount` pieces, so a streamed reply arrives in several chunks.
function splitIntoPieces(text: string, pieceCount = 6): string[] {
  if (!text) return [];
  const pieceSize = Math.max(1, Math.ceil(text.length / pieceCount));
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += pieceSize) pieces.push(text.slice(i, i + pieceSize));
  return pieces;
}

type AnthropicReplyBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

function anthropicReply(request: Request, turn: Turn) {
  const toolUses: AnthropicReplyBlock[] = (turn.tools ?? []).map((tool) => ({
    type: "tool_use",
    id: tool.id ?? newId("toolu"),
    name: tool.name,
    input: tool.input,
  }));
  const content: AnthropicReplyBlock[] = [];
  if (turn.text) content.push({ type: "text", text: turn.text });
  content.push(...toolUses);
  const usage = usageFor(request, turn);
  let stopReason = "end_turn";
  if (toolUses.length) stopReason = "tool_use";
  return {
    id: newId("msg"),
    type: "message",
    role: "assistant",
    model: request.model,
    content,
    // biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
    // biome-ignore-end lint/style/useNamingConvention: back to our own names
  };
}

type SendEvent = (event: string, data: unknown) => void;
type StreamedBlock = { block: AnthropicReplyBlock; index: number; delay: number };

const blockStart = (index: number, emptyBlock: unknown) =>
  // biome-ignore lint/style/useNamingConvention: field names follow the model APIs
  ({ type: "content_block_start", index, content_block: emptyBlock });
const blockDelta = (index: number, delta: unknown) => ({
  type: "content_block_delta",
  index,
  delta,
});

async function streamAnthropicBlock(send: SendEvent, { block, index, delay }: StreamedBlock) {
  if (block.type === "text") {
    send("content_block_start", blockStart(index, { type: "text", text: "" }));
    for (const piece of splitIntoPieces(block.text)) {
      if (delay) await sleep(delay);
      send("content_block_delta", blockDelta(index, { type: "text_delta", text: piece }));
    }
  } else {
    const emptyBlock = { type: "tool_use", id: block.id, name: block.name, input: {} };
    send("content_block_start", blockStart(index, emptyBlock));
    if (delay) await sleep(delay);
    // The whole input arrives as one piece of JSON text.
    // biome-ignore lint/style/useNamingConvention: field names follow the model APIs
    const delta = { type: "input_json_delta", partial_json: JSON.stringify(block.input) };
    send("content_block_delta", blockDelta(index, delta));
  }
  send("content_block_stop", { type: "content_block_stop", index });
}

function anthropicStream(request: Request, turn: Turn): ReadableStream {
  const reply = anthropicReply(request, turn);
  const delay = turn.chunkDelayMs ?? 0;
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send: SendEvent = (event, data) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      // The first event has no content yet; the blocks follow one by one.
      // biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
      const usageSoFar = { input_tokens: reply.usage.input_tokens, output_tokens: 1 };
      const startMessage = { ...reply, content: [], stop_reason: null, usage: usageSoFar };
      // biome-ignore-end lint/style/useNamingConvention: back to our own names
      send("message_start", { type: "message_start", message: startMessage });
      for (const [index, block] of reply.content.entries()) {
        await streamAnthropicBlock(send, { block, index, delay });
      }
      // biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
      send("message_delta", {
        type: "message_delta",
        delta: { stop_reason: reply.stop_reason, stop_sequence: null },
        usage: { output_tokens: reply.usage.output_tokens },
      });
      // biome-ignore-end lint/style/useNamingConvention: back to our own names
      send("message_stop", { type: "message_stop" });
      controller.close();
    },
  });
}

type OpenAiToolCallOut = {
  id: string;
  type: string;
  function: { name: string; arguments: string };
};

function openaiReply(request: Request, turn: Turn) {
  const toolCalls: OpenAiToolCallOut[] = (turn.tools ?? []).map((tool) => ({
    id: tool.id ?? newId("call"),
    type: "function",
    function: { name: tool.name, arguments: JSON.stringify(tool.input) },
  }));
  const usage = usageFor(request, turn);
  // A reply with no tool calls leaves the tool_calls field out altogether.
  // biome-ignore-start lint/style/useNamingConvention: field names follow the model APIs
  let toolCallsField: { tool_calls?: OpenAiToolCallOut[] } = {};
  if (toolCalls.length) toolCallsField = { tool_calls: toolCalls };
  let finishReason = "stop";
  if (toolCalls.length) finishReason = "tool_calls";
  return {
    id: newId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: turn.text ?? null, ...toolCallsField },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: usage.input,
      completion_tokens: usage.output,
      total_tokens: usage.input + usage.output,
    },
  };
  // biome-ignore-end lint/style/useNamingConvention: back to our own names
}

function openaiStream(request: Request, turn: Turn): ReadableStream {
  const reply = openaiReply(request, turn);
  const [choice] = reply.choices;
  const delay = turn.chunkDelayMs ?? 0;
  const encoder = new TextEncoder();
  // Every chunk repeats these fields.
  const header = {
    id: reply.id,
    object: "chat.completion.chunk",
    created: reply.created,
    model: reply.model,
  };
  return new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const sendDelta = (delta: unknown) =>
        // biome-ignore lint/style/useNamingConvention: field names follow the model APIs
        send({ ...header, choices: [{ index: 0, delta, finish_reason: null }] });
      sendDelta({ role: "assistant", content: "" });
      for (const piece of splitIntoPieces(turn.text ?? "")) {
        if (delay) await sleep(delay);
        sendDelta({ content: piece });
      }
      const toolCalls = choice.message.tool_calls ?? [];
      for (const [index, call] of toolCalls.entries()) {
        // biome-ignore lint/style/useNamingConvention: field names follow the model APIs
        sendDelta({ tool_calls: [{ index, ...call }] });
      }
      send({
        ...header,
        // biome-ignore lint/style/useNamingConvention: field names follow the model APIs
        choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
        usage: reply.usage,
      });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// The server.

// maxRequests protects a laptop from a loop with no stop rule: past it, every call gets an error.
export type Options = {
  scenario: Scenario;
  port?: number;
  onRequest?: (request: Request) => void;
  maxRequests?: number;
};

function notServed(method: string, pathname: string): Response {
  const message = `The practice model does not serve ${method} ${pathname}`;
  return Response.json({ error: { message } }, { status: 404 });
}

// Each API has its own error shape, so the learner's client can read the error either way.
function errorReply(isAnthropic: boolean, status: number, message: string, type: string) {
  if (isAnthropic) {
    return Response.json({ type: "error", error: { type, message } }, { status });
  }
  return Response.json({ error: { message, type } }, { status });
}

function tooManyRequests(isAnthropic: boolean, maxRequests: number): Response {
  const message =
    `The practice model stopped answering after ${maxRequests} calls in one run. ` +
    "Your loop has no stop rule.";
  if (isAnthropic) {
    return Response.json(
      { type: "error", error: { type: "rate_limit_error", message } },
      { status: 400 },
    );
  }
  return Response.json({ error: { message } }, { status: 400 });
}

// The path says which API the request speaks. Only POST requests ask the model anything.
function apiFor(method: string, pathname: string): Request["api"] | null {
  if (method !== "POST") return null;
  if (pathname.endsWith("/messages")) return "anthropic";
  if (pathname.endsWith("/chat/completions")) return "openai";
  return null;
}

// The body is the client's JSON, read as the shape its API documents.
function readRequest(api: Request["api"], body: unknown): Request {
  if (api === "anthropic") return fromAnthropic(body as AnthropicBody);
  return fromOpenAi(body as OpenAiBody);
}

async function runScenario(scenario: Scenario, request: Request, allRequests: Request[]) {
  try {
    return await scenario(request, allRequests);
  } catch (error) {
    const reason = (error as Error).message;
    return { status: 500, error: `The practice model scenario failed: ${reason}` } as Turn;
  }
}

function replyWith(request: Request, turn: Turn, isAnthropic: boolean): Response {
  if (turn.status) {
    const message = turn.error ?? "error";
    return errorReply(isAnthropic, turn.status, message, "invalid_request_error");
  }
  if (request.stream) {
    let stream: ReadableStream;
    if (isAnthropic) stream = anthropicStream(request, turn);
    else stream = openaiStream(request, turn);
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }
  if (isAnthropic) return Response.json(anthropicReply(request, turn));
  return Response.json(openaiReply(request, turn));
}

export function startPracticeModel({
  scenario,
  port = 0,
  onRequest,
  maxRequests = 200,
}: Options): PracticeModel {
  const requests: Request[] = [];
  async function answerModelCall(api: Request["api"], body: unknown): Promise<Response> {
    const request = readRequest(api, body);
    requests.push(request);
    onRequest?.(request);
    const turn = await runScenario(scenario, request, requests);
    return replyWith(request, turn, api === "anthropic");
  }
  async function answer(httpRequest: globalThis.Request): Promise<Response> {
    const { pathname } = new URL(httpRequest.url);
    const { method } = httpRequest;
    if (method === "GET" && pathname === "/health") return Response.json({ ok: true });
    if (method === "GET" && pathname === "/requests") return Response.json(requests);
    const api = apiFor(method, pathname);
    if (!api) return notServed(method, pathname);
    if (requests.length >= maxRequests) return tooManyRequests(api === "anthropic", maxRequests);
    return answerModelCall(api, await httpRequest.json());
  }
  const server = Bun.serve({ port, idleTimeout: 120, fetch: answer });
  const listeningPort = server.port;
  if (listeningPort === undefined) throw new Error("The practice model started without a port.");
  return {
    url: `http://localhost:${listeningPort}`,
    port: listeningPort,
    requests,
    stop: () => server.stop(true),
  };
}

// Helpers scenarios use to read the conversation.

export const lastUser = (request: Request) =>
  [...request.messages].reverse().find((message) => message.role === "user");

export const toolResults = (request: Request): ToolResultBlock[] =>
  request.messages.flatMap((message) =>
    message.blocks.filter((block): block is ToolResultBlock => block.type === "tool_result"),
  );

export const toolUses = (request: Request): ToolUseBlock[] =>
  request.messages.flatMap((message) =>
    message.blocks.filter((block): block is ToolUseBlock => block.type === "tool_use"),
  );

export function userText(request: Request): string {
  const userMessages = request.messages.filter((message) => message.role === "user");
  const blocks = userMessages.flatMap((message) => message.blocks);
  const textBlocks = blocks.filter((block): block is TextBlock => block.type === "text");
  return textBlocks.map((block) => block.text).join("\n");
}
