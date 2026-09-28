import { GAZETTEER, distanceMi, normalizeState, type GazetteerEntry } from '../geo';

export interface GeocodeResult {
  label: string;
  city: string;
  county: string | null;
  state: string;
  zip: string | null;
  lat: number;
  lng: number;
  kind: 'zip' | 'neighborhood' | 'city' | 'address';
}

/** Map-provider-agnostic geocoding port (Mapbox / Google / HERE / Nominatim adapters implement this). */
export interface GeocodingProvider {
  readonly name: string;
  geocode(query: string): Promise<GeocodeResult[]>;
  reverse(lat: number, lng: number): Promise<GeocodeResult | null>;
}

const fromEntry = (e: GazetteerEntry, kind: GeocodeResult['kind']): GeocodeResult => ({
  label: kind === 'city' ? `${e.city}, ${e.state}` : `${e.label}, ${e.city}, ${e.state} ${e.zip}`,
  city: e.city,
  county: e.county,
  state: e.state,
  zip: kind === 'city' ? null : e.zip,
  lat: e.lat,
  lng: e.lng,
  kind,
});

/** Offline geocoder for the beta pilot markets (DFW, Houston, Austin). */
export class GazetteerGeocoder implements GeocodingProvider {
  readonly name = 'gazetteer';
  async geocode(query: string): Promise<GeocodeResult[]> {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return [];
    const zip = q.match(/\b(\d{5})\b/)?.[1];
    if (zip) {
      const e = GAZETTEER.find((g) => g.zip === zip);
      return e ? [fromEntry(e, 'zip')] : [];
    }
    const [cityPart, statePart] = q.split(',').map((s) => s.trim());
    const state = statePart ? normalizeState(statePart) : null;
    const out: GeocodeResult[] = [];
    const cities = new Map<string, GazetteerEntry[]>();
    for (const g of GAZETTEER) {
      if (state && g.state !== state) continue;
      const key = `${g.city}|${g.state}`;
      if (!cities.has(key)) cities.set(key, []);
      cities.get(key)!.push(g);
    }
    for (const [key, entries] of cities) {
      const city = key.split('|')[0].toLowerCase();
      if (city.startsWith(cityPart)) {
        const lat = entries.reduce((s, e) => s + e.lat, 0) / entries.length;
        const lng = entries.reduce((s, e) => s + e.lng, 0) / entries.length;
        const first = city === 'dallas' ? entries[0] : { ...entries[0], lat, lng };
        out.push(fromEntry(first, 'city'));
      }
    }
    for (const g of GAZETTEER) {
      if (state && g.state !== state) continue;
      if (g.label.toLowerCase().includes(cityPart) && g.label.toLowerCase() !== g.city.toLowerCase()) out.push(fromEntry(g, 'neighborhood'));
    }
    return out.slice(0, 8);
  }
  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    let best: GazetteerEntry | null = null;
    let bestD = Infinity;
    for (const g of GAZETTEER) {
      const d = distanceMi({ lat, lng }, g);
      if (d < bestD) {
        best = g;
        bestD = d;
      }
    }
    if (!best || bestD > 40) return null;
    return { ...fromEntry(best, 'zip'), lat, lng };
  }
}

/** Mapbox Geocoding v6 adapter (production). */
export class MapboxGeocoder implements GeocodingProvider {
  readonly name = 'mapbox';
  constructor(private token: string, private fetchImpl: typeof fetch = fetch) {}
  private map(f: any): GeocodeResult {
    const ctx = f.properties?.context ?? {};
    return {
      label: f.properties?.full_address ?? f.properties?.name,
      city: ctx.place?.name ?? '',
      county: ctx.district?.name ?? null,
      state: ctx.region?.region_code ?? '',
      zip: ctx.postcode?.name ?? null,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      kind: 'address',
    };
  }
  async geocode(query: string) {
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&country=us&limit=5&access_token=${this.token}`;
    const json = (await (await this.fetchImpl(url)).json()) as any;
    return (json.features ?? []).map((f: any) => this.map(f));
  }
  async reverse(lat: number, lng: number) {
    const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&limit=1&access_token=${this.token}`;
    const json = (await (await this.fetchImpl(url)).json()) as any;
    return json.features?.[0] ? this.map(json.features[0]) : null;
  }
}
