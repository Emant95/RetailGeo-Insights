/** Geographic primitives shared by every client and data store. */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MI = 3958.7613;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles (haversine). PostGIS ST_Distance on geography is the server-side equivalent. */
export function distanceMi(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MI_TO_M = 1609.344;

export function roundMi(mi: number): number {
  return mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi);
}

/** Coordinates inside the U.S. (incl. AK, HI, PR) — coarse sanity check used by data-quality validation. */
export function isUSCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const contiguous = lat >= 24.3 && lat <= 49.5 && lng >= -125 && lng <= -66.8;
  const alaska = lat >= 51 && lat <= 71.5 && lng >= -180 && lng <= -129;
  const hawaii = lat >= 18.8 && lat <= 22.4 && lng >= -160.5 && lng <= -154.7;
  const pr = lat >= 17.8 && lat <= 18.6 && lng >= -67.4 && lng <= -65.2;
  return contiguous || alaska || hawaii || pr;
}

export const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function normalizeState(input: string): string | null {
  const s = input.trim();
  if (s.length === 2 && US_STATES[s.toUpperCase()]) return s.toUpperCase();
  const hit = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : null;
}

/**
 * Beta tax estimate: combined state + typical local sales-tax rate by state (percent).
 * Production should replace this with a TaxProvider (e.g. Avalara/TaxJar) — see providers/tax.ts.
 * Rates are overridable via the `tax.rates` system setting.
 */
export const DEFAULT_TAX_RATES: Record<string, number> = {
  TX: 8.25, OK: 8.95, LA: 9.55, AR: 9.45, NM: 7.62, CA: 8.85, NY: 8.53, FL: 7.0, GA: 7.38, IL: 8.86,
};
export const FALLBACK_TAX_RATE = 7.0;

export interface GazetteerEntry {
  zip: string;
  label: string; // neighbourhood / area name
  city: string;
  county: string;
  state: string;
  lat: number;
  lng: number;
}

/**
 * Beta gazetteer for the pilot markets. The GeocodingProvider interface lets production
 * swap this for Mapbox / Google / HERE geocoding without touching callers.
 */
export const GAZETTEER: GazetteerEntry[] = [
  { zip: '75201', label: 'Downtown', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.7876, lng: -96.7994 },
  { zip: '75204', label: 'Uptown', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.803, lng: -96.7853 },
  { zip: '75205', label: 'Highland Park', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.8363, lng: -96.7955 },
  { zip: '75206', label: 'Lower Greenville', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.831, lng: -96.7697 },
  { zip: '75214', label: 'Lakewood', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.8252, lng: -96.7475 },
  { zip: '75219', label: 'Oak Lawn', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.8114, lng: -96.8141 },
  { zip: '75226', label: 'Deep Ellum', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.7875, lng: -96.774 },
  { zip: '75208', label: 'Bishop Arts', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.7497, lng: -96.8389 },
  { zip: '75230', label: 'Preston Hollow', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.8998, lng: -96.7897 },
  { zip: '75240', label: 'North Dallas', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.931, lng: -96.7879 },
  { zip: '75243', label: 'Lake Highlands', city: 'Dallas', county: 'Dallas', state: 'TX', lat: 32.9105, lng: -96.7283 },
  { zip: '75080', label: 'Richardson', city: 'Richardson', county: 'Dallas', state: 'TX', lat: 32.9656, lng: -96.7445 },
  { zip: '75024', label: 'West Plano', city: 'Plano', county: 'Collin', state: 'TX', lat: 33.0752, lng: -96.804 },
  { zip: '75074', label: 'East Plano', city: 'Plano', county: 'Collin', state: 'TX', lat: 33.0277, lng: -96.6776 },
  { zip: '75034', label: 'Frisco', city: 'Frisco', county: 'Collin', state: 'TX', lat: 33.1497, lng: -96.8277 },
  { zip: '75069', label: 'McKinney', city: 'McKinney', county: 'Collin', state: 'TX', lat: 33.1966, lng: -96.6153 },
  { zip: '75038', label: 'Las Colinas', city: 'Irving', county: 'Dallas', state: 'TX', lat: 32.8766, lng: -96.9888 },
  { zip: '75050', label: 'Grand Prairie', city: 'Grand Prairie', county: 'Dallas', state: 'TX', lat: 32.7657, lng: -97.0086 },
  { zip: '76011', label: 'Arlington', city: 'Arlington', county: 'Tarrant', state: 'TX', lat: 32.7558, lng: -97.0864 },
  { zip: '76102', label: 'Downtown Fort Worth', city: 'Fort Worth', county: 'Tarrant', state: 'TX', lat: 32.7555, lng: -97.3308 },
  { zip: '76107', label: 'Cultural District', city: 'Fort Worth', county: 'Tarrant', state: 'TX', lat: 32.7429, lng: -97.3822 },
  { zip: '75150', label: 'Mesquite', city: 'Mesquite', county: 'Dallas', state: 'TX', lat: 32.8153, lng: -96.6307 },
  { zip: '75040', label: 'Garland', city: 'Garland', county: 'Dallas', state: 'TX', lat: 32.9243, lng: -96.6228 },
  { zip: '75006', label: 'Carrollton', city: 'Carrollton', county: 'Dallas', state: 'TX', lat: 32.9667, lng: -96.8828 },
  { zip: '75019', label: 'Coppell', city: 'Coppell', county: 'Dallas', state: 'TX', lat: 32.9673, lng: -96.9853 },
  { zip: '76051', label: 'Grapevine', city: 'Grapevine', county: 'Tarrant', state: 'TX', lat: 32.9343, lng: -97.0781 },
  { zip: '76201', label: 'Denton', city: 'Denton', county: 'Denton', state: 'TX', lat: 33.2148, lng: -97.1331 },
  { zip: '77002', label: 'Downtown Houston', city: 'Houston', county: 'Harris', state: 'TX', lat: 29.7569, lng: -95.3657 },
  { zip: '77006', label: 'Montrose', city: 'Houston', county: 'Harris', state: 'TX', lat: 29.7406, lng: -95.3911 },
  { zip: '77008', label: 'The Heights', city: 'Houston', county: 'Harris', state: 'TX', lat: 29.7983, lng: -95.4118 },
  { zip: '78701', label: 'Downtown Austin', city: 'Austin', county: 'Travis', state: 'TX', lat: 30.2711, lng: -97.7437 },
  { zip: '78704', label: 'South Austin', city: 'Austin', county: 'Travis', state: 'TX', lat: 30.2426, lng: -97.7677 },
  { zip: '78751', label: 'Hyde Park', city: 'Austin', county: 'Travis', state: 'TX', lat: 30.3096, lng: -97.7244 },
];

export const DEFAULT_LOCATION = { lat: 32.7876, lng: -96.7994, label: 'Downtown Dallas, TX 75201' };

/** Parse phrases like "within 5 miles", "10 mi" from free text. Returns radius and the remaining text. */
export function extractRadius(text: string): { radiusMi: number | null; rest: string } {
  const m = text.match(/(?:within\s+)?(\d{1,3})\s*(?:mi|mile|miles)\b/i);
  if (!m) return { radiusMi: null, rest: text };
  return { radiusMi: Number(m[1]), rest: text.replace(m[0], '').replace(/\s{2,}/g, ' ').trim() };
}
