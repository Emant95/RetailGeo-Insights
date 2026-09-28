export const usd = (cents: number | null | undefined) =>
  cents == null ? '—' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const miles = (mi: number | null | undefined) => (mi == null ? '' : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`);
export const num = (n: number) => n.toLocaleString('en-US');
export const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const label = (s: string) => s.replace(/_/g, ' ');
export function when(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const STORE_TYPE_LABEL: Record<string, string> = {
  grocery: 'Grocery', convenience: 'Convenience', gas_station: 'Gas station', pharmacy: 'Pharmacy', specialty: 'Specialty', retail: 'Retail',
};
export const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function time12(t: string) {
  const [h, m] = t.split(':').map(Number);
  if (h === 24 || (h === 23 && m === 59)) return 'midnight';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
