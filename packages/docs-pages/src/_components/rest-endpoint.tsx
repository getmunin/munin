'use client';

import { useState } from 'react';
import { PathFmt } from './path-fmt';
import { AuthChip } from './auth-chip';
import { SchemaTree, type SchemaField } from './schema-tree';
import { CurlBlock } from './curl-block';
import type { EndpointEntry, Operation } from '../_lib/openapi';
import { typeLabel, requestBodyFields } from '../_lib/openapi';

export function RestEndpoint({ ep }: { ep: EndpointEntry }) {
  const responseEntries = Object.entries(ep.op.responses ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const initialTab = responseEntries[0]?.[0] ?? '200';
  const [tab, setTab] = useState(initialTab);

  const tabClass = (code: string) => {
    const k = code.startsWith('2')
      ? '2xx'
      : code.startsWith('4')
        ? '4xx'
        : code.startsWith('5')
          ? '5xx'
          : '';
    return 'code-' + k + (tab === code ? ' active' : '');
  };

  const params = ep.op.parameters ?? [];
  const groups = (['path', 'query', 'header'] as const)
    .map((k) => ({ k, list: params.filter((p) => p.in === k) }))
    .filter((g) => g.list.length);

  const bodyFields: SchemaField[] = requestBodyFields(ep.op);
  const hasJsonBody = !!ep.op.requestBody?.content?.['application/json'];

  return (
    <article className="ep" id={ep.id}>
      <header className="ep-h">
        <span className={'method m-' + ep.method.toUpperCase()}>{ep.method.toUpperCase()}</span>
        <span className="path">
          <PathFmt path={ep.path} />
        </span>
        <AuthChip mode={ep.authMode} />
      </header>
      <div className="ep-body">
        {ep.op.summary && <p className="summary">{ep.op.summary}</p>}
        {ep.op.description && ep.op.description !== ep.op.summary && (
          <p className="desc">{ep.op.description}</p>
        )}

        {groups.map((g) => (
          <div className="field-block" key={g.k}>
            <div className="field-block-h">
              {g.k} parameters{' '}
              <span style={{ color: 'var(--docs-mute)', opacity: 0.6 }}>· {g.list.length}</span>
            </div>
            <table className="field-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {g.list.map((p, i) => (
                  <tr key={i}>
                    <td className="f-name">{p.name}</td>
                    <td className="f-type">{typeLabel(p.schema)}</td>
                    <td className="f-req">
                      {p.required ? (
                        <span className="req-yes">required</span>
                      ) : (
                        <span className="req-no">optional</span>
                      )}
                    </td>
                    <td className="f-desc">{p.description ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {hasJsonBody && (
          <div className="field-block">
            <div className="field-block-h">
              Request body{' '}
              <span style={{ color: 'var(--docs-mute)', opacity: 0.6 }}>· application/json</span>
            </div>
            <SchemaTree fields={bodyFields} />
          </div>
        )}

        {responseEntries.length > 0 && (
          <div className="field-block">
            <div className="field-block-h">Responses</div>
            <div className="resp-tabs">
              {responseEntries.map(([code]) => (
                <button key={code} className={tabClass(code)} onClick={() => setTab(code)} type="button">
                  {code}
                </button>
              ))}
            </div>
            {responseEntries
              .filter(([code]) => code === tab)
              .map(([code, r]) => (
                <div className="resp-body" key={code}>
                  {r.description || ' '}
                  {schemaChipFor(r) && <span className="schema-chip">{schemaChipFor(r)}</span>}
                </div>
              ))}
          </div>
        )}

        <CurlBlock command={curlFor(ep)} label="cURL" />
      </div>
    </article>
  );
}

function schemaChipFor(r: NonNullable<Operation['responses']>[string]): string | null {
  const json = r.content?.['application/json']?.schema;
  if (!json) return null;
  if (json.$ref) return json.$ref.replace('#/components/schemas/', '');
  if (Array.isArray(json.type)) return json.type.join(' | ');
  return json.type ?? null;
}

function curlFor(ep: EndpointEntry): string {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  let cmd = `curl -X ${ep.method.toUpperCase()} \\\n  '${base}${ep.path}'`;
  if (ep.authMode !== 'public') {
    cmd += ` \\\n  -H 'Authorization: Bearer $MUNIN_API_KEY'`;
  }
  const fields = requestBodyFields(ep.op);
  if (fields.length > 0) {
    cmd += ` \\\n  -H 'Content-Type: application/json' \\\n  -d '{ "${fields[0]!.name}": "..." }'`;
  }
  return cmd;
}
