export function Footer() {
  return (
    <footer className="border-t border-border-subtle bg-bg-abyss">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-glow-cyan to-glow-green opacity-80" />
              <span className="font-display font-semibold">BloomCast</span>
            </div>
            <p className="text-sm text-fg-muted">
              Predictive early warning for cyanobacteria blooms in urban freshwater.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-fg-primary mb-3">Product</h4>
            <ul className="space-y-2 text-sm text-fg-secondary">
              <li><a href="/dashboard" className="hover:text-glow-cyan">Forecast</a></li>
              <li><a href="/replay" className="hover:text-glow-cyan">Replay Theatre</a></li>
              <li><a href="/sandbox" className="hover:text-glow-cyan">Resilience Sandbox</a></li>
              <li><a href="/streamflush" className="hover:text-glow-cyan">StreamFlush</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-fg-primary mb-3">Community</h4>
            <ul className="space-y-2 text-sm text-fg-secondary">
              <li><a href="/report" className="hover:text-glow-cyan">Submit Observation</a></li>
              <li><a href="/scorecard" className="hover:text-glow-cyan">Integrity Scorecard</a></li>
              <li><a href="/about" className="hover:text-glow-cyan">Model Card</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-fg-primary mb-3">Legal</h4>
            <ul className="space-y-2 text-sm text-fg-secondary">
              <li>MIT License (code)</li>
              <li>CC-BY 4.0 (documentation)</li>
              <li className="text-fg-muted text-xs pt-2">
                &ldquo;BloomCast outputs are advisory support for environmental
                decision-makers and do not constitute a safety determination.&rdquo;
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-border-faint text-xs text-fg-faint">
          Data: Copernicus Sentinel-2 · Open-Meteo CC-BY 4.0 · OpenFreeMap tiles
        </div>
      </div>
    </footer>
  );
}