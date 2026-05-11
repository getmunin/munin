export interface SchemaField {
  name: string;
  type: string;
  req: boolean;
  d: string;
}

export function SchemaTree({ fields }: { fields: SchemaField[] }) {
  if (!fields.length) {
    return (
      <div
        className="schema-tree"
        style={{
          color: 'var(--docs-mute)',
          fontFamily: 'var(--munin-mono)',
          fontSize: 11,
          padding: '8px 0',
          borderLeft: 0,
        }}
      >
        (no fields documented)
      </div>
    );
  }
  return (
    <div className="schema-tree">
      {fields.map((f, i) => (
        <div className="row" key={i}>
          <span className="n">{f.name}</span>
          <span className="t">{f.type}</span>
          <span className="r" style={{ color: f.req ? 'var(--docs-red)' : 'var(--docs-mute)' }}>
            {f.req ? 'required' : 'optional'}
          </span>
          <span className="d">{f.d}</span>
        </div>
      ))}
    </div>
  );
}
