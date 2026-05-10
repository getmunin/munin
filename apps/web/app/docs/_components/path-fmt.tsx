export function PathFmt({ path }: { path: string }) {
  const parts = path.split(/(\{[^}]+\})/g);
  return (
    <span>
      {parts.map((p, i) =>
        /^\{[^}]+\}$/.test(p) ? (
          <span key={i} className="var">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
