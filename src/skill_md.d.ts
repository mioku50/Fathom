/** SKILL.md is bundled as text by the wrangler rule in wrangler.toml. */
declare module '*.md' {
  const content: string;
  export default content;
}
