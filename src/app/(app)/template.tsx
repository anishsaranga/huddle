/**
 * Remounts on every tab navigation (Next templates are keyed per segment):
 * subtle fade + 8px rise, enter only. CSS-only so the page is visible without
 * JS; the animation ends with no transform left behind, so it doesn't leave a
 * containing block for fixed descendants.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
