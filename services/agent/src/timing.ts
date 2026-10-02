/**
 * Per-turn stopwatch. One is created when a chat request arrives and travels with the turn, so each step records how
 * long it took without the steps knowing about each other. Values are whole milliseconds (plus a few labels), stored
 * as JSON on the turn row to find out where the time goes before anything is optimised.
 */
export interface TurnTimings {
  /** Request received to reply fully written. */
  total_turn_ms?: number;
  /** Waiting behind an earlier turn of the same call. */
  queue_ms?: number;
  /** Session Controller checks before the model. */
  controller_ms?: number;
  /** Ensure the conversation row and load history. */
  history_ms?: number;
  /** Knowledge search. */
  retrieval_ms?: number;
  /** Time to the first message from the agent SDK: subprocess start and handshake, or ~0 when pre-warmed. */
  sdk_start_ms?: number;
  /** The whole SDK loop: model, tools and structured output. */
  agent_ms?: number;
  /** Sum of tool_use to tool_result gaps (MCP round trips as the agent sees them). */
  mcp_ms?: number;
  tools?: { name: string; ms: number }[];
  /** agent_ms minus sdk_start_ms and mcp_ms: model thinking and writing. */
  model_ms?: number;
  /** Writing the turn to the database. */
  save_ms?: number;
  /** Request received to first content written to Vapi: the server-side stand-in for time to first audio. */
  first_write_ms?: number;
  /** When the spoken acknowledgement went out, and which kind. */
  ack_ms?: number;
  ack_category?: string;
  /** Customer stopped speaking (webhook arrival) to request received. Approximate: it includes webhook delay. */
  speech_to_agent_ms?: number;
  prewarmed?: boolean;
}

export class TurnTimer {
  private readonly start: number;
  private readonly values: Record<string, unknown> = {};

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.start = clock();
  }

  /** The raw clock, for measuring a step that is not wrapped in `span`. */
  time(): number {
    return this.clock();
  }

  /** Milliseconds since the stopwatch started. */
  elapsed(): number {
    return Math.round(this.clock() - this.start);
  }

  /** Sets a value, rounding numbers to whole milliseconds. */
  set<K extends keyof TurnTimings>(key: K, value: TurnTimings[K]): void {
    this.values[key] = typeof value === 'number' ? Math.max(0, Math.round(value)) : value;
  }

  get<K extends keyof TurnTimings>(key: K): TurnTimings[K] | undefined {
    return this.values[key] as TurnTimings[K] | undefined;
  }

  /** Runs a step and records how long it took under `key`. The step's result and errors pass through. */
  async span<T>(key: keyof TurnTimings, fn: () => Promise<T>): Promise<T> {
    const began = this.clock();
    try {
      return await fn();
    } finally {
      this.set(key, this.clock() - began);
    }
  }

  /** Adds one tool call and keeps `mcp_ms` as the sum. */
  addTool(name: string, ms: number): void {
    const tools = (this.values.tools as { name: string; ms: number }[] | undefined) ?? [];
    tools.push({ name, ms: Math.max(0, Math.round(ms)) });
    this.values.tools = tools;
    this.values.mcp_ms = tools.reduce((sum, t) => sum + t.ms, 0);
  }

  /** Fills in the derived figures once the SDK loop is done. */
  finishAgent(): void {
    const agent = this.get('agent_ms');
    if (agent === undefined) return;
    this.set('model_ms', agent - (this.get('sdk_start_ms') ?? 0) - (this.get('mcp_ms') ?? 0));
  }

  toJSON(): TurnTimings {
    return { ...this.values } as TurnTimings;
  }
}
