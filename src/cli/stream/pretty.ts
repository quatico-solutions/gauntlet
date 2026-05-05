import type { StreamEvent, StreamRenderer } from "./renderer";
import type { WriteSink } from "./jsonl";
import { makePaint, type Paint } from "./colors";
import { softWrap } from "./wrap";
import { formatToolArgs } from "./format-args";
import { formatTiming } from "./format-timing";
import { formatAnomalyEvent } from "./format-event";

const RULE = "──────────────────────────────────────────────────────";
const TURN_RULE_WIDTH = 52;

export interface PrettyOptions {
  color: boolean;
  columns: number;
}

export class PrettyRenderer implements StreamRenderer {
  private paint: Paint;
  private maxTurns: number | undefined;
  private runId: string | undefined;
  private model: string | undefined;
  private outDir: string | undefined;
  private pendingRewrite: { base: string } | undefined;
  private pendingToolBlank = false;
  /**
   * Set when a turn opens with no thinking and no assistant text — i.e.
   * the agent just emitted tool calls. The divider is deferred so the
   * next `tool_call` can render inline as `─ N ─  ▸ ...` on a single
   * line. If anything other than a tool_call arrives next we flush the
   * divider on its own line.
   */
  private pendingTurnDivider: { num: number } | undefined;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private spinnerStartMs = 0;
  private spinnerActive = false;

  constructor(private sink: WriteSink, private opts: PrettyOptions) {
    this.paint = makePaint(opts.color);
  }

  handle(event: StreamEvent): void {
    if (this.spinnerActive && event.type !== "llm_request") {
      this.clearSpinner();
    }
    // An interleaved event would invalidate the cursor-up+erase contract
    // of the pending tool_call line (we'd erase the wrong line). Drop the
    // pending state — the eventual tool_result falls through to the
    // two-line path and the stale `⋯` stays on the call line. The agent
    // loop today never interleaves other events between a call and its
    // result, but this guard keeps the renderer safe if that ever changes.
    if (this.pendingRewrite && event.type !== "tool_result") {
      this.pendingRewrite = undefined;
    }
    // Defer the trailing blank after tool_result. For most events we emit
    // it before they print so the previous tools and the next section get
    // breathing room. `llm_response` is special-cased: it owns its own
    // leading blank decision (a content-bearing turn wants the blank; a
    // tool-only turn does not, since the short divider is going to inline
    // with the next tool call).
    if (this.pendingToolBlank && event.type !== "llm_response") {
      if (event.type !== "tool_call") this.write("");
      this.pendingToolBlank = false;
    }
    // Same idea for the deferred turn divider: anything that isn't the
    // tool_call we're trying to inline with forces the divider to flush
    // on its own line first.
    if (this.pendingTurnDivider && event.type !== "tool_call") {
      this.write(this.turnRule(this.pendingTurnDivider.num, false));
      this.pendingTurnDivider = undefined;
    }
    switch (event.type) {
      case "run_start":
        this.renderRunStart(event);
        return;
      case "llm_request":
        if (this.opts.color) this.startSpinner();
        return;
      case "llm_response":
        this.renderLlmResponse(event);
        return;
      case "tool_call":
        this.renderToolCall(event);
        return;
      case "tool_result":
        this.renderToolResult(event);
        return;
      case "event":
        if (event.name === "run_error") this.renderRunError(event);
        else this.renderEventMeta(event);
        return;
      case "run_end":
        this.renderRunEnd(event);
        return;
      default:
        return;
    }
  }

  close(): void {
    if (this.spinnerActive) this.clearSpinner();
  }

  private write(line: string): void {
    this.sink.write(line + "\n");
  }

  /**
   * Build a turn divider. `wide` adds trailing dashes to fill out a
   * roughly-banner-width rule (used when the turn opens with content);
   * the short form is just `─ N ─` and is meant to inline with the
   * following tool call.
   */
  private turnRule(turn: number, wide: boolean): string {
    const p = this.paint;
    const prefix = `─ ${turn} ─`;
    if (!wide) return p.dim(prefix);
    const filler = "─".repeat(Math.max(2, TURN_RULE_WIDTH - prefix.length));
    return p.dim(prefix + filler);
  }

  private renderRunStart(e: StreamEvent): void {
    const p = this.paint;
    this.maxTurns = Number(e.maxTurns ?? 0);
    this.runId = String(e.runId ?? "");
    this.model = String(e.model ?? "");
    this.outDir = e.outDir ? String(e.outDir) : undefined;
    const adapterLine = e.viewport
      ? `${e.adapter} · viewport ${String(e.viewport).replace("x", "×")}`
      : String(e.adapter);
    this.write(p.dim(RULE));
    this.write(`  ${p.dim("runId    ")} ${e.runId}`);
    this.write(`  ${p.dim("card     ")} ${e.cardId}`);
    this.write(`  ${p.dim("target   ")} ${e.target ?? "—"}`);
    this.write(`  ${p.dim("model    ")} ${e.model}`);
    this.write(`  ${p.dim("adapter  ")} ${adapterLine}`);
    this.write(`  ${p.dim("max turns")} ${e.maxTurns}`);
    if (this.outDir) this.write(`  ${p.dim("evidence ")} ${this.outDir}`);
    this.write(p.dim(RULE));
    this.write("");
  }

  private renderRunEnd(e: StreamEvent): void {
    const p = this.paint;
    const status = String(e.status);
    const ok = status === "pass";
    const mark = ok ? p.green("✓") : p.red("✗");
    const statusTxt = ok ? p.green(status) : p.red(status);
    this.write(`${p.dim("─── Run complete ──────────────────────────────")} ${mark} ${statusTxt}`);
    this.write(`  ${p.dim("runId")}     ${this.runId ?? ""}`);
    this.write(`  ${p.dim("duration")}  ${formatDuration(Number(e.durationMs ?? 0))}`);
    const usage = e.usage as Record<string, number> | undefined;
    const turns = usage?.turns ?? 0;
    const max = this.maxTurns ?? "?";
    this.write(`  ${p.dim("turns")}     ${turns} / ${max}`);
    if (usage) {
      const parts = [
        `in ${formatThousands(usage.inputTokens)}`,
        `out ${formatThousands(usage.outputTokens)}`,
      ];
      if (usage.cacheReadInputTokens) parts.push(`cache ${formatThousands(usage.cacheReadInputTokens)}`);
      this.write(`  ${p.dim("usage")}     ${parts.join("  ")}`);
    }
    const evidence = e.outDir ? String(e.outDir) : this.outDir;
    if (evidence) this.write(`  ${p.dim("evidence")}  ${evidence}`);

    // Full report — summary / reasoning / observations rendered after the
    // status block so the reader can see why the run ended the way it did.
    const summary = String(e.summary ?? "").trim();
    const reasoning = String(e.reasoning ?? "").trim();
    const observations = (e.observations ?? []) as Array<{ kind: string; description: string }>;
    const wrapWidth = Math.max(20, this.opts.columns - 4);

    if (summary) {
      this.write("");
      this.write(`  ${p.bold("Summary")}`);
      for (const line of softWrap(summary, wrapWidth)) this.write(`    ${line}`);
    }
    if (reasoning) {
      this.write("");
      this.write(`  ${p.bold("Reasoning")}`);
      for (const line of softWrap(reasoning, wrapWidth)) this.write(`    ${line}`);
    }
    if (observations.length > 0) {
      this.write("");
      this.write(`  ${p.bold(`Observations (${observations.length})`)}`);
      for (const obs of observations) {
        const kind = p.dim(`[${obs.kind}]`);
        const lines = softWrap(String(obs.description ?? ""), Math.max(20, wrapWidth - 4));
        this.write(`    · ${kind} ${lines[0] ?? ""}`);
        for (let i = 1; i < lines.length; i++) this.write(`      ${lines[i]}`);
      }
    }
  }

  private renderLlmResponse(e: StreamEvent): void {
    const p = this.paint;
    const turn = Number(e.turn ?? 0);
    const thinking = (e.thinking ?? []) as Array<{ text: string }>;
    const text = String(e.text ?? "").trim();
    const hasContent = thinking.length > 0 || text.length > 0;

    if (!hasContent) {
      // Tool-only turn: defer the divider so the first tool_call inlines.
      // Suppress any pending tool_result blank — there's no section break
      // between consecutive tool-only turns; they should pack together.
      this.pendingToolBlank = false;
      this.pendingTurnDivider = { num: turn };
      return;
    }

    // Content turn: flush the deferred blank so the wide divider sits
    // separated from the previous turn's tools.
    if (this.pendingToolBlank) {
      this.write("");
      this.pendingToolBlank = false;
    }
    this.write(this.turnRule(turn, true));

    let firstBlock = true;
    for (const th of thinking) {
      if (!firstBlock) this.write("");
      firstBlock = false;
      this.write(`  ${p.magenta("~ thinking")}`);
      for (const line of softWrap(th.text, this.opts.columns - 4)) {
        this.write(`    ${p.dim(line)}`);
      }
    }

    if (text.length > 0) {
      if (!firstBlock) this.write("");
      firstBlock = false;
      // Drop the `= assistant` label — assistant is the default speaker.
      // A leading `»` glyph on the first line announces the block; wrap
      // continuations indent to sit under the first line's content.
      const lines = softWrap(text, this.opts.columns - 4);
      this.write(`  ${p.yellow("»")} ${lines[0] ?? ""}`);
      for (let i = 1; i < lines.length; i++) this.write(`    ${lines[i]}`);
    }
    this.write("");
  }

  private renderToolCall(e: StreamEvent): void {
    const p = this.paint;
    const name = String(e.name ?? "");
    const formatted = formatToolArgs(name, e.arguments as Record<string, unknown> | undefined);

    // If a turn divider has been deferred because the turn was tool-only,
    // inline it onto this call's line. Otherwise use the normal 2-space
    // indent so the call sits under the wide rule it follows.
    let head: string;
    if (this.pendingTurnDivider) {
      head = `${this.turnRule(this.pendingTurnDivider.num, false)}  `;
      this.pendingTurnDivider = undefined;
    } else {
      head = "  ";
    }

    const bodyParts: string[] = [];
    if (formatted.body) bodyParts.push(p.dim(formatted.body));
    if (formatted.marker) bodyParts.push(p.dim(formatted.marker));
    const bodyStr = bodyParts.length > 0 ? " " + bodyParts.join(" ") : "";
    const base = `${head}${p.cyan("▸")} ${p.bold(name)}${bodyStr}`;

    if (this.opts.color) {
      // Inline-rewrite path: include a trailing pending marker so the user sees progress.
      this.write(`${base} ${p.dim("⋯")}`);
      this.pendingRewrite = { base };
    } else {
      this.write(base);
      this.pendingRewrite = undefined;
    }
  }

  private renderToolResult(e: StreamEvent): void {
    const p = this.paint;
    const ms = Number(e.durationMs ?? 0);
    const err = Boolean(e.error);
    const timing = formatTiming(ms, err);
    const timingText = timing ? (timing.slow && err ? p.red(timing.text) : timing.slow ? p.yellow(timing.text) : p.dim(timing.text)) : "";

    if (this.pendingRewrite && this.opts.color) {
      // Erase the previous line and rewrite with the final timing inline.
      const mark = err ? p.red("✗") : p.green("✓");
      this.sink.write("\x1b[1A\x1b[2K"); // cursor up, erase line
      const tail = timing ? `   ${mark} ${timingText}` : (err ? `   ${mark}` : "");
      this.write(`${this.pendingRewrite.base}${tail}`);
      this.pendingRewrite = undefined;
    } else if (timing || err) {
      // Two-line fallback — same as the existing no-color path. Skipped
      // entirely when timing is suppressed AND the call succeeded; the
      // call line stands on its own.
      const mark = err ? p.red("✗") : p.green("✓");
      this.write(`    ${p.dim("↳")} ${mark}${timing ? ` ${timingText}` : ""}`);
    }

    // Secondary lines always print as a separate indented line regardless of mode.
    if (err) {
      const text = String(e.text ?? "");
      if (text) this.write(`      ${p.dim("╵ error ")} ${text}`);
      if (e.hint) this.write(`      ${p.dim("╵ hint  ")} ${String(e.hint)}`);
    } else {
      if (e.image)            this.write(`      ${p.dim("→")} ${p.blue(String(e.image))}`);
      else if (e.artifact)    this.write(`      ${p.dim("→")} ${p.blue(String(e.artifact))}`);
      else if (e.capturePath) this.write(`      ${p.dim("→")} ${p.blue(String(e.capturePath))}`);
      else if (String(e.name ?? "") === "read_output") {
        // Surface the captured prompt for CLI/TUI `read_output` calls.
        // Without this, a sequence of agent keystrokes (`press Enter`,
        // `press Enter`, …) reads as opaque noise because each prompt
        // (`package name:`, `version:`, …) lives in the prior read_output
        // body and was previously dropped. Scoped to `read_output` so
        // unrelated text-bearing tools (e.g. file `read`) don't leak a
        // misleading last-line snippet into the stream.
        const snippet = pickResultSnippet(String(e.text ?? ""), this.opts.columns - 8);
        if (snippet) this.write(`      ${p.dim("↳")} ${p.dim(snippet)}`);
      }
    }
    this.pendingToolBlank = true;
  }

  private renderEventMeta(e: StreamEvent): void {
    const p = this.paint;
    const formatted = formatAnomalyEvent(e as Record<string, unknown>);
    const body = formatted.body ? `  ${p.dim(formatted.body)}` : "";
    this.write(`  ${p.dim(`· ${formatted.name}`)}${body}`);
  }

  private renderRunError(e: StreamEvent): void {
    const p = this.paint;
    const turn = Number(e.turn ?? 0);
    this.write("");
    this.write(`${p.dim("─── Run failed ──────────────────────────────────")} ${p.red("✗")} ${p.red("error")}`);
    this.write(`  ${p.dim("runId")}     ${this.runId ?? ""}`);
    this.write(`  ${p.dim("turn")}      ${turn} / ${this.maxTurns ?? "?"}`);
    this.write(`  ${p.dim("error")}     ${String(e.message ?? "")}`);
  }

  private startSpinner(): void {
    this.spinnerActive = true;
    this.spinnerStartMs = Date.now();
    this.renderSpinnerLine();
    this.spinnerTimer = setInterval(() => this.renderSpinnerLine(), 1000);
  }

  private clearSpinner(): void {
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
    this.spinnerActive = false;
    this.sink.write("\r\x1b[2K");
  }

  private renderSpinnerLine(): void {
    const elapsed = Math.floor((Date.now() - this.spinnerStartMs) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    this.sink.write(`\r\x1b[2K${this.paint.dim(`⋯ waiting for model · ${mm}:${ss}`)}`);
  }
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(1)}s`;
}

function formatThousands(n: number | undefined): string {
  if (n === undefined) return "0";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function pickResultSnippet(text: string, maxWidth: number): string | null {
  if (!text) return null;
  // Pick the last non-empty line. For readline-style prompts that redraw
  // (e.g. `npm init`'s default-rendering) the active prompt is the bottom
  // line of the captured buffer; the lines above are leading banner text.
  const lines = text.split("\n");
  let line: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed) {
      line = trimmed;
      break;
    }
  }
  if (!line) return null;
  const width = Math.max(20, maxWidth);
  if (line.length <= width) return line;
  return line.slice(0, width - 1) + "…";
}
