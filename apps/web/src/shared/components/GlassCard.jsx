export function GlassCard({ children, className = '', hover = true }) {
  return (
    <div
      className={`rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,23,42,0.25)] ${
        hover ? 'transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-[0_12px_36px_rgba(37,99,235,0.22)]' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
