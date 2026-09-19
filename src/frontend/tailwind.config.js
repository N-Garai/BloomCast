module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "bg-abyss": "#02060f",
        "bg-deep": "#04111f",
        "bg-surface": "#082236",
        "bg-elevated": "#0d3050",
        "bg-overlay": "#1a4a6e",
        "fg-primary": "#e8f4f8",
        "fg-secondary": "#9fb8c7",
        "fg-muted": "#5a7888",
        "fg-faint": "#3d5666",
        "glow-cyan": "#00f0d4",
        "glow-green": "#00ff88",
        "glow-yellow": "#ffcc00",
        "glow-orange": "#ff8800",
        "glow-red": "#ff3355",
        "glow-magenta": "#ff00aa",
        "viz-chl": "#00d4aa",
        "viz-temp": "#ff6b35",
        "viz-do": "#4ecdc4",
        "viz-turb": "#ffd23f",
        "viz-citizen": "#c77dff",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        "glow-sm": "0 0 12px -2px rgba(0, 240, 212, 0.25)",
        "glow-md": "0 0 24px -4px rgba(0, 240, 212, 0.40)",
        "glow-lg": "0 0 40px -6px rgba(255, 51, 85, 0.50)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "fade-up": "fadeInUp 0.6s ease-out both",
        "scroll-reveal": "scrollReveal 0.8s ease-out both",
      },
      keyframes: {
        fadeInUp: { "0%": { opacity: 0, transform: "translateY(16px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        scrollReveal: { "0%": { opacity: 0, transform: "translateY(32px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        pulse: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.45 } },
      },
    },
  },
  plugins: [],
};