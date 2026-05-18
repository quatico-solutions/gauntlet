// Ambient declaration for `with { type: "text" }` imports of .md files.
// Bun resolves these at runtime; this tells TypeScript the resolved value
// is a string. Used by src/agent/prompts/loader.ts to bundle prompt text.
declare module "*.md" {
  const text: string;
  export default text;
}
