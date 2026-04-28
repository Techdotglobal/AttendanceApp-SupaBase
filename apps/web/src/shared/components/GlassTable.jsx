export function GlassTable({ columns, children }) {
  return (
    <div className="overflow-auto rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,23,42,0.25)]">
      <table className="min-w-full text-sm text-slate-100">
        <thead className="bg-white/5 border-b border-white/10">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`p-3 text-left font-medium text-slate-200 ${col.className || ''}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
