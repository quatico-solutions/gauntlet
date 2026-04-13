#!/usr/bin/env bun
import { createServer, VERSION } from "./server.ts";

interface Flags {
  port: number;
  bind: string;
  token: string | undefined;
  allowCommand: RegExp | undefined;
  sessionTimeoutSec: number;
  maxBodyBytes: number;
}

function parseArgs(argv: string[]): Flags {
  const f: Flags = {
    port: Number(process.env.GAUNTLET_RELAY_PORT ?? 4455),
    bind: process.env.GAUNTLET_RELAY_BIND ?? "127.0.0.1",
    token: process.env.GAUNTLET_RELAY_TOKEN,
    allowCommand: undefined,
    sessionTimeoutSec: 300,
    maxBodyBytes: 8 * 1024 * 1024,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "--port": f.port = Number(next()); break;
      case "--bind": f.bind = next(); break;
      case "--token": f.token = next(); break;
      case "--allow-command": f.allowCommand = new RegExp(next()); break;
      case "--session-timeout": f.sessionTimeoutSec = Number(next()); break;
      case "--max-body-bytes": f.maxBodyBytes = Number(next()); break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return f;
}

function printHelp() {
  console.log(`gauntlet-relay ${VERSION}

Usage: bun run src/bin.ts [flags]

Flags:
  --port <n>              TCP port (default 4455, env GAUNTLET_RELAY_PORT)
  --bind <addr>           Bind address (default 127.0.0.1, env GAUNTLET_RELAY_BIND)
  --token <str>           Shared bearer token (required, env GAUNTLET_RELAY_TOKEN)
  --allow-command <re>    Optional regex allowlist for commands
  --session-timeout <s>   GC idle timeout for terminated sessions (default 300)
  --max-body-bytes <n>    Reject oversized bodies (default 8388608)
`);
}

const flags = parseArgs(process.argv.slice(2));
if (!flags.token) {
  console.error("error: --token (or GAUNTLET_RELAY_TOKEN) is required");
  process.exit(2);
}
if (flags.bind !== "127.0.0.1" && flags.bind !== "localhost") {
  console.warn(
    `WARNING: binding to ${flags.bind} — relay is remote-shell-equivalent behind the bearer token.`,
  );
}

const handle = await createServer({
  port: flags.port,
  bind: flags.bind,
  token: flags.token,
  sessionTimeoutSec: flags.sessionTimeoutSec,
  maxBodyBytes: flags.maxBodyBytes,
  allowCommand: flags.allowCommand,
});

console.log(
  `gauntlet-relay listening on http://${flags.bind}:${handle.port} (auth: bearer token${flags.allowCommand ? `, allowlist: ${flags.allowCommand}` : ""})`,
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await handle.stop();
    process.exit(0);
  });
}
