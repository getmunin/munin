---
'@getmunin/backend-core': patch
'@getmunin/agent-host': patch
---

Replace inline `safeParse + throw BadRequestException` boilerplate across ~44 control-plane handlers with the `nestjs-zod` `createZodDto` + global `ZodValidationPipe` pattern. Each gated route's body is now declared at the parameter signature (e.g. `@Body() input: CreateApiKeyBody`), validated automatically, and reported via the standard Nest 400 response shape. The schema is still defined inline with Zod — `createZodDto(z.object({...}))` wraps it into a class that the pipe recognises. No behaviour change at the wire level; default values now apply where they previously did (the pipe runs `safeParse`).

Internal note for OpenAPI consumers: `nestjs-zod` also generates JSON-schema fragments from these DTOs, so the upcoming `docs:generate` step will start documenting bodies it previously left as `{}`. No action required.
