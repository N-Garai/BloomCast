const DIVIDER_TONES = {
  cyan: "via-glow-cyan/50",
  orange: "via-glow-orange/50",
  violet: "via-glow-violet/50",
  magenta: "via-glow-magenta/50",
} as const;

const GLOW_TONES = {
  cyan: "bg-glow-cyan/10",
  orange: "bg-glow-orange/10",
  violet: "bg-glow-violet/10",
  magenta: "bg-glow-magenta/10",
} as const;

/**
 * Blend band between two homepage sections: a soft color handoff (gradient
 * wash + hairline + blurred glow) so scrolling from one section to the next
 * feels like one continuous scene instead of hard cuts.
 */
export function SectionDivider({
  tone = "cyan",
}: {
  tone?: keyof typeof DIVIDER_TONES;
}) {
  return (
    <div className="relative h-16 overflow-hidden bg-bg-abyss" aria-hidden>
      <div className={`absolute inset-0 bg-gradient-to-b from-transparent ${DIVIDER_TONES[tone].replace("/50", "/10")} to-transparent`} />
      <div
        className={`absolute inset-x-[12%] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent ${DIVIDER_TONES[tone]} to-transparent`}
      />
      <div
        className={`absolute left-1/2 top-1/2 h-10 w-2/3 -translate-x-1/2 -translate-y-1/2 blur-2xl ${GLOW_TONES[tone]}`}
      />
    </div>
  );
}
