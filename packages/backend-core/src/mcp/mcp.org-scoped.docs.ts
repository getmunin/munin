import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiParam } from '@nestjs/swagger';

export function OrgScopedMcpDocs(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'MCP endpoint addressed at one organization',
      description:
        'Serves the same tools as /mcp, but only for the organization named in the path. A ' +
        'credential belonging to any other organization is refused, so the URL is a guarantee ' +
        'rather than a hint — which is what lets one person hold connections to several ' +
        'organizations at once, since MCP clients key a connection by its URL. An admin API key ' +
        'already carries its organization; an OAuth connection is bound to the organization in ' +
        'the URL at consent time.',
    }),
    ApiParam({
      name: 'orgId',
      required: true,
      description:
        'Organization id: org_ followed by 22 lowercase alphanumerics. Case-sensitive; anything ' +
        'else is rejected rather than falling back to the shared endpoint.',
      schema: { type: 'string', pattern: '^org_[0-9a-z]{22}$' },
    }),
  );
}
