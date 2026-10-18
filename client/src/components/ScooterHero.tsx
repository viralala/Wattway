/**
 * WattWay · Team Kothimbir 🌿
 * ScooterHero.tsx — the red scooter on its road curve, with a pulsing lightning
 * bolt overlaid on the side panel so it reads as electric.
 */
import scooter from '../assets/images/scooter.png';

export function ScooterHero() {
  return (
    <div className="scooter" aria-hidden="true">
      {/* road curve the scooter sits on */}
      <svg className="scooter-road" viewBox="0 0 420 120" preserveAspectRatio="none">
        <path d="M-10 120 C 60 -10, 360 -10, 430 120 Z" fill="#231f20" />
        <path
          d="M30 108 C 100 24, 320 24, 390 108"
          fill="none"
          stroke="#fbf6e4"
          strokeWidth="4"
          strokeDasharray="14 14"
          strokeLinecap="round"
        />
      </svg>
      <div className="scooter-body">
        <img src={scooter} alt="" width={421} height={593} />
        <svg className="scooter-bolt" viewBox="0 0 24 36">
          <defs>
            <filter id="bolt-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d="M14 1 L2 20 H10 L8 35 L22 13 H13.5 Z"
            fill="#ffd23f"
            stroke="#fff6c9"
            strokeWidth="0.8"
            strokeLinejoin="round"
            filter="url(#bolt-glow)"
          />
        </svg>
      </div>
    </div>
  );
}
