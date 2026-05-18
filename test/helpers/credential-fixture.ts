import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface CredentialFixture {
  contextDir: string;
  resolverPath?: string;
}

export interface CredentialFixtureOpts {
  /**
   * Files to write under the context dir. Map of relative-path → contents.
   * If omitted, the context dir is created but left empty.
   */
  contextFiles?: Record<string, string>;
  /**
   * If provided, a sibling tmp dir is created with `resolver.sh` containing
   * this body, marked 0755. The path appears as `resolverPath` in the
   * yielded fixture.
   */
  resolverScript?: string;
  /** Override the prefix used for the tmp dirs (debugging aid). */
  prefix?: string;
}

/**
 * Stand up a credential-resolver fixture (context dir, optionally a
 * resolver script) for the lifetime of `fn`, then clean up regardless
 * of outcome. Use in tests that need a `contextRoot` and/or a
 * `credentialResolver.path` to drive `CLIAdapter` or similar.
 */
export async function withCredentialFixture<T>(
  opts: CredentialFixtureOpts,
  fn: (fx: CredentialFixture) => Promise<T> | T,
): Promise<T> {
  const prefix = opts.prefix ?? "gauntlet-cred-";
  const contextDir = mkdtempSync(join(tmpdir(), `${prefix}ctx-`));
  let resolverDir: string | undefined;
  let resolverPath: string | undefined;
  try {
    for (const [name, body] of Object.entries(opts.contextFiles ?? {})) {
      writeFileSync(join(contextDir, name), body);
    }
    if (opts.resolverScript !== undefined) {
      resolverDir = mkdtempSync(join(tmpdir(), `${prefix}res-`));
      resolverPath = join(resolverDir, "resolver.sh");
      writeFileSync(resolverPath, opts.resolverScript);
      chmodSync(resolverPath, 0o755);
    }
    return await fn({ contextDir, resolverPath });
  } finally {
    rmSync(contextDir, { recursive: true, force: true });
    if (resolverDir) rmSync(resolverDir, { recursive: true, force: true });
  }
}
