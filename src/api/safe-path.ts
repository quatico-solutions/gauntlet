import { resolve } from "path";

export function isSafePath(base: string, target: string): boolean {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  return resolvedTarget.startsWith(resolvedBase + "/") || resolvedTarget === resolvedBase;
}
