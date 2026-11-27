---
"@getmunin/agent-host": patch
"@getmunin/agent-runtime": patch
"@getmunin/analytics-tracker": patch
"@getmunin/backend-core": patch
"@getmunin/chat-widget": patch
"@getmunin/core": patch
"@getmunin/dashboard-pages": patch
"@getmunin/db": patch
"@getmunin/docs-pages": patch
"@getmunin/emails": patch
"@getmunin/inspector-app": patch
"@getmunin/mcp-toolkit": patch
"@getmunin/sdk": patch
"@getmunin/types": patch
"@getmunin/ui": patch
---

Bump dependencies to their latest minor and patch releases, including better-auth 1.7.28, NestJS 12.6, React 19.3, nodemailer 10.6 and mailparser 3.15. No major versions change. `@nestjs/common` is held at exactly 12.6.0 because 12.6.1 types `applyDecorators` with a return value that TypeScript rejects as a method or class decorator. Norwegian mobile numbers now display as `+47 999 99 999` instead of in pairs, following libphonenumber's updated metadata.
