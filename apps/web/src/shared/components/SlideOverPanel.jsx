export function SlideOverPanel({ open, onClose, children }) {
  return (
    <div className={`fixed inset-0 z-40 ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-950/40 backdrop-blur-[1px] transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-md border-l border-white/20 bg-slate-900/70 backdrop-blur-2xl shadow-[0_8px_40px_rgba(15,23,42,0.45)] transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {children}
      </aside>
    </div>
  );
}
