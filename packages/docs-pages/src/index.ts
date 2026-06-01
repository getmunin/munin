export { default as DocsLayout, metadata as docsMetadata } from './layout';
export { default as DocsHome } from './page';
export { default as GuidesIndex } from './guides/page';
export { default as GuideAudiencesAndTokens } from './guides/audiences-and-tokens/page';
export { default as GuideChatWidget } from './guides/chat-widget/page';
export { default as GuideConnectClaude } from './guides/connect-claude/page';
export { default as GuideConnectChatGpt } from './guides/connect-chatgpt/page';
export { default as GuideConnectGemini } from './guides/connect-gemini/page';
export { default as GuideSkillsVsToolsVsRest } from './guides/skills-vs-tools-vs-rest/page';
export { default as GuideRecipeLeadEnricher } from './guides/recipe-lead-enricher/page';
export { default as GuideRecipeLeadScorer } from './guides/recipe-lead-scorer/page';
export { default as GuideRecipeConversationDistiller } from './guides/recipe-conversation-distiller/page';
export { default as GuideRecipeOutreachDrafter } from './guides/recipe-outreach-drafter/page';
export { default as GuideRecipeBugSpotter } from './guides/recipe-bug-spotter/page';
export { default as GuideRecipeRenewalWatcher } from './guides/recipe-renewal-watcher/page';
export { default as GuideRecipeWinBack } from './guides/recipe-win-back/page';
export { default as GuideRecipeEventFollowup } from './guides/recipe-event-followup/page';
export { default as McpDocs, type McpIndexProps } from './mcp/page';
export { default as RestDocs, type RestIndexProps } from './rest/page';
export {
  endpointsFromSpec,
  type EndpointEntry,
  type OpenApiDoc,
  type TagGroup,
} from './_lib/openapi';
export type { McpTool, McpSchema } from './_lib/mcp';
export { default as SkillsIndex } from './skills/page';
export {
  default as SkillDetail,
  generateStaticParams as generateSkillStaticParams,
} from './skills/[...slug]/page';
