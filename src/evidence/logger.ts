import { mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";

export type BrowserEventCategory =
  | "console"
  | "exception"
  | "log"
  | "network-ws";

export type ActionObserver = (
  action: string,
  params: Record<string, unknown>,
) => void;

export class EvidenceLogger {
  private outDir: string;
  private screenshotCount = 0;
  private _screenshots: string[] = [];
  private observers: Set<ActionObserver> = new Set();

  constructor(outDir: string) {
    this.outDir = outDir;
    mkdirSync(join(outDir, "screenshots"), { recursive: true });
  }

  get screenshots(): string[] {
    return [...this._screenshots];
  }

  /**
   * Register an observer for action events. Returns an unsubscribe function
   * that removes the observer when called. A misbehaving observer (one that
   * throws) will not prevent other observers from receiving the action.
   */
  addObserver(fn: ActionObserver): () => void {
    this.observers.add(fn);
    return () => {
      this.observers.delete(fn);
    };
  }

  private notifyObservers(
    action: string,
    params: Record<string, unknown>,
  ): void {
    for (const fn of this.observers) {
      try {
        fn(action, params);
      } catch {
        /* one observer shouldn't break another */
      }
    }
  }

  logAction(action: string, params: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      params,
    };
    appendFileSync(
      join(this.outDir, "run.jsonl"),
      JSON.stringify(entry) + "\n"
    );
    this.notifyObservers(action, params);
  }

  logBrowserEvent(
    category: BrowserEventCategory,
    data: Record<string, unknown>,
  ): void {
    const entry = {
      timestamp: new Date().toISOString(),
      category,
      ...data,
    };
    appendFileSync(
      join(this.outDir, `${category}.jsonl`),
      JSON.stringify(entry) + "\n",
    );
  }

  saveScreenshot(data: Buffer, name?: string): string {
    if (!name) {
      this.screenshotCount++;
      name = String(this.screenshotCount).padStart(3, "0");
    }
    const relativePath = `screenshots/${name}.png`;
    writeFileSync(join(this.outDir, relativePath), data);
    this._screenshots.push(relativePath);
    return relativePath;
  }

  get logPath(): string {
    return "run.jsonl";
  }
}
