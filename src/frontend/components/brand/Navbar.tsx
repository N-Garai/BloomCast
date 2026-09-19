import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Forecast" },
  { href: "/replay", label: "Replay" },
  { href: "/sandbox", label: "Resilience" },
  { href: "/streamflush", label: "StreamFlush" },
  { href: "/report", label: "Report" },
  { href: "/alerts", label: "Alerts" },
  { href: "/fhir", label: "FHIR" },
  { href: "/scorecard", label: "Scorecard" },
  { href: "/about", label: "About" },
];

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border-subtle">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-glow-cyan to-glow-green opacity-80" />
          <span className="font-display text-lg font-semibold tracking-tight">
            Bloom<span className="text-glow-cyan">Cast</span>
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-fg-secondary hover:text-fg-primary transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
        <Link
          href="/dashboard"
          className="px-4 py-2 rounded-lg bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan text-sm font-medium hover:bg-glow-cyan/20 transition-colors"
        >
          View Dashboard
        </Link>
      </div>
    </nav>
  );
}