import { parseArgs } from "./cli/args";
import { run } from "./cli/run";

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  switch (args.command) {
    case "run":
      await run(args.scenarioPath, args.target, args.outDir, args.adapter, args.models);
      break;
    case "validate": {
      const { validateScenario } = await import("./cli/validate");
      const result = validateScenario(args.scenarioPath);
      if (result.valid) {
        console.log(JSON.stringify({ valid: true }));
      } else {
        console.log(JSON.stringify({ valid: false, errors: result.errors }));
        process.exit(1);
      }
      break;
    }
    case "fanout": {
      const { fanout } = await import("./cli/fanout");
      await fanout(args.scenarioPath, args.outDir, args.models);
      break;
    }
    case "serve": {
      const { createApp } = await import("./api/server");
      const app = createApp(args.dataDir ?? ".");
      const port = args.port;
      console.error(`vet server listening on port ${port}`);
      Bun.serve({
        port,
        fetch: app.fetch,
      });
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
