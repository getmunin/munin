import { SchemaTree, type SchemaField } from './schema-tree';
import type { McpTool, McpSchema } from '../_lib/mcp';

export function McpCard({ tool }: { tool: McpTool }) {
  const fields = schemaFields(tool.inputSchema);
  return (
    <article className="mcp-card" id={tool.name}>
      <div className="h">
        <span className="name">{tool.name}</span>
        {tool.title && <span className="title">{tool.title}</span>}
      </div>
      <div className="pills">
        {tool.audiences.map((a) => (
          <span key={a} className={'pill audience-' + a}>
            {a.replace('_', '-')}
          </span>
        ))}
        {tool.danger === 'writes' && <span className="pill danger-writes">writes</span>}
        {tool.danger === 'destructive' && <span className="pill danger-destructive">destructive</span>}
        {tool.danger === null && <span className="pill">read-only</span>}
      </div>
      <p className="desc">{tool.description}</p>
      <div className="scopes">
        {tool.scopes.map((s) => (
          <span key={s} className="scope">
            {s}
          </span>
        ))}
      </div>
      <details>
        <summary>Input schema</summary>
        <SchemaTree fields={fields} />
      </details>
    </article>
  );
}

function schemaFields(schema: McpSchema | undefined): SchemaField[] {
  if (!schema?.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: schemaType(prop),
    req: required.has(name),
    d: prop.description ?? '',
  }));
}

function schemaType(s: McpSchema | undefined): string {
  if (!s) return 'unknown';
  if (s.enum) return 'enum';
  if (Array.isArray(s.type)) return s.type.join(' | ');
  if (s.type === 'array') return `${schemaType(s.items)}[]`;
  return s.type ?? 'unknown';
}
