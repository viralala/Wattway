/**
 * WattWay · Team Kothimbir 🌿
 * ComingSoon.tsx — placeholder for pages that land in a later build phase.
 */
import { PageHead } from '../components/ui';

export default function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="container">
      <PageHead eyebrow="coming up" title={title}>
        {blurb}
      </PageHead>
      <div className="panel">
        <p className="muted" style={{ margin: 0 }}>
          This page is scheduled for a later build phase.
        </p>
      </div>
    </div>
  );
}
