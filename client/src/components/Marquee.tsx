/**
 * WattWay · Team Kothimbir
 * Marquee.tsx — a banner of text that scrolls sideways forever.
 *
 * The phrases are laid out twice in a row and the strip slides left by exactly
 * one copy, then loops, so the seam never shows. The second copy is hidden from
 * screen readers so the phrases are read once. Hovering pauses it.
 */

/** Each copy repeats the phrases this many times so one copy is always wider than the screen. */
const REPEAT = 3;

function Bolt() {
  return (
    <svg className="marquee-bolt" viewBox="0 0 24 36" aria-hidden="true">
      <path d="M14 1 2 20h8l-2 15 14-22h-8.5z" />
    </svg>
  );
}

export function Marquee({
  items,
  label,
  tone = 'clear',
  reverse = false,
  seconds = 120,
}: {
  items: string[];
  /** What the banner is, for screen readers. */
  label: string;
  /** `clear`: no background, dashed rules above and below. `light`: a pale yellow wash. */
  tone?: 'clear' | 'light';
  reverse?: boolean;
  /** Time for one full loop; higher is slower. */
  seconds?: number;
}) {
  const copy = (hidden: boolean) => (
    <ul className="marquee-copy" aria-hidden={hidden || undefined}>
      {Array.from({ length: REPEAT }, (_, r) =>
        items.map((text, i) => (
          <li key={`${r}-${i}`} aria-hidden={r > 0 || undefined}>
            {text}
            <Bolt />
          </li>
        )),
      )}
    </ul>
  );
  return (
    <section className={`marquee ${tone}${reverse ? ' reverse' : ''}`} aria-label={label}>
      <div className="marquee-track" style={{ ['--loop' as string]: `${seconds}s` }}>
        {copy(false)}
        {copy(true)}
      </div>
    </section>
  );
}
