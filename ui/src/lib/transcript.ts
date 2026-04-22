// Transcript event model + reducer for run.jsonl
//
// Shape mirrors src/evidence/logger.ts on the server side. We don't import
// across the boundary (the UI tsconfig rootDir is `ui/src`), so keep the
// type definitions here in sync if the server types change.

export interface BaseEvent {
  eventId: number;
  parentEventId: number;
  ts: string;
}

export interface RunStartEvent extends BaseEvent {
  type: "run_start";
  runId: string;
  cardId: string;
  target?: string;
  provider: string;
  model: string;
  adapter: string;
  maxTurns: number;
  toolTimeoutMs: number;
  contextTreeBytes: number;
}

export interface SystemPromptEvent extends BaseEvent {
  type: "system_prompt";
  content: string;
}

export interface UserMessageEvent extends BaseEvent {
  type: "user_message";
  turn: number;
  content: string;
}

export interface LlmRequestEvent extends BaseEvent {
  type: "llm_request";
  turn: number;
  messageCount: number;
}

export interface LlmResponseEvent extends BaseEvent {
  type: "llm_response";
  turn: number;
  stopReason: string;
  text: string;
  thinking: Array<{ text: string; signature?: string }>;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  rawAssistantMessage: unknown;
}

export interface ToolCallEvent extends BaseEvent {
  type: "tool_call";
  turn: number;
  toolUseId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  turn: number;
  toolUseId: string;
  name: string;
  durationMs: number;
  text: string;
  image: string | null;
  artifact: string | null;
  textTruncated?: true;
  textBytes?: number;
  error: boolean;
}

export interface AnomalyEvent extends BaseEvent {
  type: "event";
  name: string;
  [k: string]: unknown;
}

export interface RunEndEvent extends BaseEvent {
  type: "run_end";
  status: string;
  summary: string;
  reasoning: string;
  observationCount: number;
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    turns: number;
  };
}

export type TranscriptEvent =
  | RunStartEvent
  | SystemPromptEvent
  | UserMessageEvent
  | LlmRequestEvent
  | LlmResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | AnomalyEvent
  | RunEndEvent;

export interface ToolPair {
  toolUseId: string;
  call: ToolCallEvent;
  result?: ToolResultEvent;
}

export interface TurnModel {
  turn: number;
  llmRequest?: LlmRequestEvent;
  llmResponse?: LlmResponseEvent;
  tools: ToolPair[];
}

export interface TranscriptModel {
  runId?: string;
  runStart?: RunStartEvent;
  systemPrompt?: SystemPromptEvent;
  userMessage?: UserMessageEvent;
  turns: Map<number, TurnModel>;
  runEnd?: RunEndEvent;
  anomalies: AnomalyEvent[];
  ordered: TranscriptEvent[];
  maxEventId: number;
}

export function emptyTranscript(): TranscriptModel {
  return {
    turns: new Map(),
    anomalies: [],
    ordered: [],
    maxEventId: 0,
  };
}

function cloneTurn(turn: TurnModel): TurnModel {
  return {
    turn: turn.turn,
    llmRequest: turn.llmRequest,
    llmResponse: turn.llmResponse,
    tools: [...turn.tools],
  };
}

function ensureTurn(model: TranscriptModel, turnNumber: number): [Map<number, TurnModel>, TurnModel] {
  const turns = new Map(model.turns);
  const existing = turns.get(turnNumber);
  const turn: TurnModel = existing
    ? cloneTurn(existing)
    : { turn: turnNumber, tools: [] };
  turns.set(turnNumber, turn);
  return [turns, turn];
}

export function applyEvent(model: TranscriptModel, event: TranscriptEvent): TranscriptModel {
  if (event.eventId <= model.maxEventId) {
    // Idempotent: already applied.
    return model;
  }

  const ordered = [...model.ordered, event];
  const maxEventId = event.eventId;

  switch (event.type) {
    case "run_start":
      return {
        ...model,
        ordered,
        maxEventId,
        runId: event.runId,
        runStart: event,
      };

    case "system_prompt":
      return { ...model, ordered, maxEventId, systemPrompt: event };

    case "user_message":
      return { ...model, ordered, maxEventId, userMessage: event };

    case "llm_request": {
      const [turns, turn] = ensureTurn(model, event.turn);
      turn.llmRequest = event;
      return { ...model, ordered, maxEventId, turns };
    }

    case "llm_response": {
      const [turns, turn] = ensureTurn(model, event.turn);
      turn.llmResponse = event;
      return { ...model, ordered, maxEventId, turns };
    }

    case "tool_call": {
      const [turns, turn] = ensureTurn(model, event.turn);
      turn.tools.push({ toolUseId: event.toolUseId, call: event });
      return { ...model, ordered, maxEventId, turns };
    }

    case "tool_result": {
      const [turns, turn] = ensureTurn(model, event.turn);
      const idx = turn.tools.findIndex((t) => t.toolUseId === event.toolUseId);
      if (idx === -1) {
        console.warn(
          `[transcript] tool_result for toolUseId=${event.toolUseId} has no matching tool_call in turn ${event.turn}; dropping`,
        );
        return { ...model, ordered, maxEventId };
      }
      turn.tools[idx] = { ...turn.tools[idx], result: event };
      return { ...model, ordered, maxEventId, turns };
    }

    case "event":
      return {
        ...model,
        ordered,
        maxEventId,
        anomalies: [...model.anomalies, event],
      };

    case "run_end":
      return { ...model, ordered, maxEventId, runEnd: event };

    default: {
      // Unknown event type — keep it in `ordered` but don't touch anything else.
      const _exhaustive: never = event;
      void _exhaustive;
      return { ...model, ordered, maxEventId };
    }
  }
}

export function reduceTranscript(events: TranscriptEvent[]): TranscriptModel {
  return events.reduce(applyEvent, emptyTranscript());
}

// Parse newline-delimited JSON. Invalid lines are skipped with a warning.
export function parseJsonl(text: string): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && typeof obj.type === "string") {
        out.push(obj as TranscriptEvent);
      } else {
        console.warn(`[transcript] line ${i + 1}: missing or invalid 'type' field`);
      }
    } catch (e) {
      console.warn(`[transcript] line ${i + 1}: JSON parse failed`, e);
    }
  });
  return out;
}

// Helpers for render-time consumers.

export function turnsInOrder(model: TranscriptModel): TurnModel[] {
  return Array.from(model.turns.values()).sort((a, b) => a.turn - b.turn);
}

export function totalUsage(model: TranscriptModel): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  for (const turn of model.turns.values()) {
    const u = turn.llmResponse?.usage;
    if (!u) continue;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
    cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
  }
  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens };
}
