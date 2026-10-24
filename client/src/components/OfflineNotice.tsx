/**
 * WattWay · Team Kothimbir 🌿
 * OfflineNotice.tsx — the small banner shown when a page is running on the
 * built-in sample data because the live API can't be reached.
 */
export function OfflineNotice({ children }: { children?: string }) {
  return (
    <p className="notice st-sample" role="note">
      {children ?? 'Showing sample data — the live API is unreachable.'}
    </p>
  );
}
