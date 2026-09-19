const LEVELS = [
  { color: "bg-glow-green", label: "Low", range: "0–30%" },
  { color: "bg-glow-yellow", label: "Moderate", range: "30–50%" },
  { color: "bg-glow-orange", label: "Elevated", range: "50–70%" },
  { color: "bg-glow-red", label: "High", range: "70–85%" },
  { color: "bg-glow-magenta", label: "Critical", range: "85–100%" },
];

export function RiskLegend() {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-fg-muted mb-2">Risk Scale</h3>
      <div className="space-y-1.5">
        {LEVELS.map(l => (
          <div key={l.label} className="flex items-center gap-2 text-xs">
            <span className={`w-3 h-3 rounded-full ${l.color}`} />
            <span className="text-fg-secondary">{l.label}</span>
            <span className="text-fg-faint font-mono">{l.range}</span>
          </div>
        ))}
      </div>
    </div>
  );
}