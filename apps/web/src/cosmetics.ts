export const COSMETIC_COLORS = ['#56f0d0', '#c9a7ff', '#ffc875', '#80bdff', '#ff7eb6'] as const;
export const COSMETIC_TRAILS = ['line', 'dots', 'spark'] as const;
export type Cosmetics = { color: typeof COSMETIC_COLORS[number]; trail: typeof COSMETIC_TRAILS[number] };
const key = 'neon-grid-cosmetics-v1';
export function loadCosmetics(): Cosmetics {
  try { const saved = JSON.parse(localStorage.getItem(key) ?? '{}'); if (COSMETIC_COLORS.includes(saved.color) && COSMETIC_TRAILS.includes(saved.trail)) return saved; } catch { /* Use default. */ }
  return { color: COSMETIC_COLORS[0], trail: 'line' };
}
export function saveCosmetics(cosmetics: Cosmetics) { localStorage.setItem(key, JSON.stringify(cosmetics)); }
