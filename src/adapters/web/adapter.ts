import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Adapter } from "../adapter";
import type { ToolDefinition } from "../../models/provider";
import type { EvidenceLogger } from "../../evidence/logger";

// The forked CDP library is CommonJS JS — use require for bun compatibility
const chrome = require("./lib/chrome-ws-lib");

export class WebAdapter implements Adapter {
  async start(url: string): Promise<void> {
    await chrome.startChrome(true); // headless
    await chrome.navigate(0, url);
  }

  async close(): Promise<void> {
    await chrome.killChrome();
  }

  toolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "screenshot",
        description: "Take a screenshot of the current page or a specific element",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector to screenshot a specific element",
            },
            fullPage: {
              type: "boolean",
              description: "Capture the full scrollable page",
            },
          },
        },
      },
      {
        name: "click",
        description: "Click an element matching the given CSS selector",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector of the element to click",
            },
          },
          required: ["selector"],
        },
      },
      {
        name: "type",
        description:
          "Type text into an element. If selector is provided, clicks it first then fills.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
            selector: {
              type: "string",
              description: "CSS selector of the input element",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "press",
        description:
          "Press a special key (Enter, Tab, Escape, ArrowDown, etc.)",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key name to press" },
          },
          required: ["key"],
        },
      },
      {
        name: "navigate",
        description: "Navigate the browser to a URL",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
          },
          required: ["url"],
        },
      },
      {
        name: "extract",
        description:
          "Extract text content from the page or a specific element",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description:
                "CSS selector to extract from. Omit for full page markdown.",
            },
          },
        },
      },
      {
        name: "eval",
        description: "Evaluate a JavaScript expression in the page context",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "JavaScript expression to evaluate",
            },
          },
          required: ["expression"],
        },
      },
      {
        name: "wait_for",
        description: "Wait for an element or text to appear on the page",
        parameters: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector to wait for",
            },
            text: {
              type: "string",
              description: "Text content to wait for",
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds (default 5000)",
            },
          },
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<string> {
    logger.logAction(name, args);

    switch (name) {
      case "screenshot": {
        const tmpFile = join(
          tmpdir(),
          `vet-screenshot-${Date.now()}.png`
        );
        await chrome.screenshot(
          0,
          tmpFile,
          (args.selector as string) ?? null,
          (args.fullPage as boolean) ?? false
        );
        const data = readFileSync(tmpFile);
        const saved = logger.saveScreenshot(Buffer.from(data));
        try {
          unlinkSync(tmpFile);
        } catch {
          // temp file cleanup is best-effort
        }
        return `Screenshot saved to ${saved}`;
      }
      case "click": {
        await chrome.click(0, args.selector as string);
        return "clicked";
      }
      case "type": {
        const selector = args.selector as string | undefined;
        const text = args.text as string;
        if (selector) {
          await chrome.fill(0, selector, text);
        } else {
          // No selector — type via keyboard
          for (const char of text) {
            await chrome.keyboardPress(0, char);
          }
        }
        return "typed";
      }
      case "press": {
        await chrome.keyboardPress(0, args.key as string);
        return "pressed";
      }
      case "navigate": {
        await chrome.navigate(0, args.url as string);
        return "navigated";
      }
      case "extract": {
        const selector = args.selector as string | undefined;
        if (selector) {
          const text = await chrome.extractText(0, selector);
          return text;
        }
        const markdown = await chrome.generateMarkdown(0);
        return markdown;
      }
      case "eval": {
        const result = await chrome.evaluate(0, args.expression as string);
        return typeof result === "string" ? result : JSON.stringify(result);
      }
      case "wait_for": {
        const timeout = (args.timeout as number) ?? 5000;
        if (args.selector) {
          await chrome.waitForElement(0, args.selector as string, timeout);
          return "element found";
        }
        if (args.text) {
          await chrome.waitForText(0, args.text as string, timeout);
          return "text found";
        }
        return "nothing to wait for — provide selector or text";
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
