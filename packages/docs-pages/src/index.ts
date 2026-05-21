export { default as DocsLayout, metadata as docsMetadata } from './layout';
export { default as DocsHome } from './page';
export { default as GuidesIndex } from './guides/page';
export { default as GuideAudiencesAndTokens } from './guides/audiences-and-tokens/page';
export { default as GuideChatWidget } from './guides/chat-widget/page';
export { default as GuideSkillsVsToolsVsRest } from './guides/skills-vs-tools-vs-rest/page';
export { default as McpDocs } from './mcp/page';
export { default as RestDocs } from './rest/page';
export { default as SkillsIndex } from './skills/page';
export {
  default as SkillDetail,
  generateStaticParams as generateSkillStaticParams,
} from './skills/[...slug]/page';
