import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HIGHWAYS, LAKES, PLACES, RIVERS } from './basemap';
import { STORE_TYPE_COLOR } from '../ui/icons';
import { STORE_TYPE_LABEL } from '../lib/format';

/**
 * Map service abstraction. Pages talk to <MapView>; the provider behind it is chosen by
 * configuration (VITE_MAP_PROVIDER) and can be swapped without touching callers.
 *  - schematic: offline SVG vector map (default; works in restricted environments)
 *  - leaflet:   OpenStreetMap tiles via Leaflet (production-style tiles; lazy-loaded)
 */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  kind?: string; // store type → color
  label?: string; // short text on marker, e.g. price
  dim?: boolean;
}
export interface MapViewProps {
  markers: MapMarker[];
  center?: { lat: number; lng: number };
  radiusMi?: number;
  user?: { lat: number; lng: number } | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  renderPopup?: (m: MapMarker) => ReactNode;
  ariaLabel: string;
  height?: number | string;
  legend?: boolean;
}

const LeafletMap = lazy(() => import('./LeafletMap'));

export function MapView(props: MapViewProps) {
  const provider = import.meta.env.VITE_MAP_PROVIDER ?? 'schematic';
  if (provider === 'leaflet') {
    return (
      <Suspense fallback={<div className="map" style={{ height: props.height ?? '100%' }} />}>
        <LeafletMap {...props} />
      </Suspense>
    );
  }
  return <SchematicMap {...props} />;
}

// ─── Web Mercator helpers ─────────────────────────────────────────────
const TILE = 256;
const project = (lat: number, lng: number, z: number) => {
  const s = TILE * Math.pow(2, z);
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
};
const unproject = (x: number, y: number, z: number) => {
  const s = TILE * Math.pow(2, z);
  const lng = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
};
const metersPerPx = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);

function fitView(points: { lat: number; lng: number }[], w: number, h: number, padPx = 48) {
  if (points.length === 0) return { center: { lat: 32.8, lng: -96.8 }, zoom: 10 };
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  let zoom = 15;
  for (; zoom > 3; zoom -= 0.25) {
    const a = project(maxLat, minLng, zoom), b = project(minLat, maxLng, zoom);
    if (b.x - a.x <= w - padPx * 2 && b.y - a.y <= h - padPx * 2) break;
  }
  return { center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }, zoom: Math.min(zoom, 14.5) };
}

function SchematicMap({ markers, center, radiusMi, user, selectedId, onSelect, renderPopup, ariaLabel, height, legend = true }: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState<{ center: { lat: number; lng: number }; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; c: { x: number; y: number }; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(200, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit when the data set changes (not on every render).
  const fitKey = `${markers.map((m) => m.id).join(',')}|${center?.lat},${center?.lng}|${radiusMi}|${Math.round(size.w)}x${Math.round(size.h)}`;
  useEffect(() => {
    const pts: { lat: number; lng: number }[] = markers.map((m) => ({ lat: m.lat, lng: m.lng }));
    if (center && radiusMi) {
      const dLat = radiusMi / 69;
      const dLng = radiusMi / (69 * Math.cos((center.lat * Math.PI) / 180));
      pts.push({ lat: center.lat + dLat, lng: center.lng + dLng }, { lat: center.lat - dLat, lng: center.lng - dLng });
    } else if (center) pts.push(center);
    if (user) pts.push(user);
    const v = fitView(pts, size.w, size.h, 36);
    if (center && radiusMi) v.center = center;
    setView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const v = view ?? { center: center ?? { lat: 32.8, lng: -96.8 }, zoom: 11 };
  const c = project(v.center.lat, v.center.lng, v.zoom);
  const toPx = useCallback((lat: number, lng: number) => {
    const p = project(lat, lng, v.zoom);
    return { x: p.x - c.x + size.w / 2, y: p.y - c.y + size.h / 2 };
  }, [v.zoom, c.x, c.y, size.w, size.h]);
  const path = (pts: [number, number][]) => pts.map(([la, ln], i) => { const p = toPx(la, ln); return `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');

  const zoomBy = (dz: number, at?: { x: number; y: number }) => {
    setView((cur) => {
      const cv = cur ?? v;
      const nz = Math.min(16, Math.max(4, cv.zoom + dz));
      if (!at) return { center: cv.center, zoom: nz };
      const cc = project(cv.center.lat, cv.center.lng, cv.zoom);
      const world = { x: cc.x + at.x - size.w / 2, y: cc.y + at.y - size.h / 2 };
      const ll = unproject(world.x, world.y, cv.zoom);
      const wp = project(ll.lat, ll.lng, nz);
      const nc = unproject(wp.x - (at.x - size.w / 2), wp.y - (at.y - size.h / 2), nz);
      return { center: nc, zoom: nz };
    });
  };

  // Non-passive wheel listener so zooming the map doesn't scroll the page.
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  useEffect(() => {
    const el = box.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(e.deltaY < 0 ? 0.5 : -0.5, { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Cluster markers that overlap on screen.
  const clusters = useMemo(() => {
    const out: { x: number; y: number; items: MapMarker[] }[] = [];
    const sorted = [...markers].sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0));
    for (const m of sorted) {
      const p = toPx(m.lat, m.lng);
      const hit = m.id === selectedId ? null : out.find((cl) => Math.hypot(cl.x - p.x, cl.y - p.y) < 22 && !cl.items.some((i) => i.id === selectedId));
      if (hit) hit.items.push(m);
      else out.push({ x: p.x, y: p.y, items: [m] });
    }
    return out;
  }, [markers, toPx, selectedId]);

  const radiusPx = center && radiusMi ? (radiusMi * 1609.344) / metersPerPx(center.lat, v.zoom) : 0;
  const cpx = center ? toPx(center.lat, center.lng) : null;
  const upx = user ? toPx(user.lat, user.lng) : null;
  const selected = markers.find((m) => m.id === selectedId);
  const spx = selected ? toPx(selected.lat, selected.lng) : null;
  const roadW = Math.max(1.5, Math.min(6, (v.zoom - 8) * 1.1));
  const kinds = [...new Set(markers.map((m) => m.kind).filter(Boolean))] as string[];

  return (
    <div className="map" ref={box} style={{ height: height ?? '100%' }}>
      <svg
        role="application"
        aria-label={`${ariaLabel}. Use the list for a text alternative. Tab to focus a store marker, Enter to open it.`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, c: { ...c }, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) setView({ center: unproject(d.c.x - dx, d.c.y - dy, v.zoom), zoom: v.zoom });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved && (e.target as Element).tagName === 'rect') onSelect?.(null);
        }}
      >
        <rect x="0" y="0" width={size.w} height={size.h} fill="var(--map-land)" />
        {/* graticule */}
        {Array.from({ length: 24 }, (_, i) => {
          const step = v.zoom > 11 ? 0.02 : v.zoom > 9 ? 0.1 : 0.5;
          const lat0 = Math.floor(v.center.lat / step) * step + (i - 12) * step;
          const lng0 = Math.floor(v.center.lng / step) * step + (i - 12) * step;
          const a = toPx(lat0, v.center.lng), b = toPx(v.center.lat, lng0);
          return (
            <g key={i}>
              <line x1={0} x2={size.w} y1={a.y} y2={a.y} stroke="var(--map-grid)" strokeWidth="1" />
              <line y1={0} y2={size.h} x1={b.x} x2={b.x} stroke="var(--map-grid)" strokeWidth="1" />
            </g>
          );
        })}
        {LAKES.map((l, i) => <path key={`l${i}`} d={`${path(l)} Z`} fill="var(--map-water)" />)}
        {RIVERS.map((r, i) => <path key={`r${i}`} d={path(r)} fill="none" stroke="var(--map-water)" strokeWidth={Math.max(2, roadW)} strokeLinecap="round" strokeLinejoin="round" />)}
        {HIGHWAYS.map((h, i) => <path key={`e${i}`} d={path(h.path)} fill="none" stroke="var(--map-road-edge)" strokeWidth={roadW + 2} strokeLinecap="round" strokeLinejoin="round" />)}
        {HIGHWAYS.map((h, i) => <path key={`h${i}`} d={path(h.path)} fill="none" stroke={h.kind === 'interstate' ? 'var(--map-road)' : 'var(--map-road)'} strokeWidth={roadW} strokeLinecap="round" strokeLinejoin="round" />)}
        {v.zoom >= 9 && HIGHWAYS.map((h, i) => {
          const mid = h.path[Math.floor(h.path.length / 2)];
          const p = toPx(mid[0], mid[1]);
          if (p.x < -20 || p.y < -20 || p.x > size.w + 20 || p.y > size.h + 20) return null;
          const w = 8 + h.ref.length * 6.2;
          return (
            <g key={`s${i}`} transform={`translate(${p.x} ${p.y})`} aria-hidden="true">
              {h.kind === 'interstate' ? (
                <path d={`M${-w / 2},-8 h${w} v6 q0,9 ${-w / 2},12 q${-w / 2},-3 ${-w / 2},-12 Z`} fill="#1f4f9a" stroke="#fff" strokeWidth="1.2" />
              ) : h.kind === 'us' ? (
                <rect x={-w / 2} y={-8} width={w} height={16} rx="3" fill="#fff" stroke="#222" strokeWidth="1.2" />
              ) : (
                <rect x={-w / 2} y={-8} width={w} height={16} rx="8" fill="#fff" stroke="#222" strokeWidth="1.2" />
              )}
              <text y="3.5" textAnchor="middle" style={{ font: '800 9px var(--font-display)' }} fill={h.kind === 'interstate' ? '#fff' : '#111'}>{h.ref}</text>
            </g>
          );
        })}
        {PLACES.filter((pl) => (pl.rank === 1 && v.zoom >= 6) || (pl.rank === 2 && v.zoom >= 9.5) || (pl.rank === 3 && v.zoom >= 11.5)).map((pl) => {
          const p = toPx(pl.lat, pl.lng);
          return <text key={pl.name} x={p.x} y={p.y} textAnchor="middle" aria-hidden="true" style={{ font: `${pl.rank === 1 ? 800 : 700} ${pl.rank === 1 ? 14 : 11}px var(--font-display)`, letterSpacing: '0.06em', textTransform: 'uppercase', paintOrder: 'stroke' }} fill="var(--ink-3)" stroke="var(--map-land)" strokeWidth="3">{pl.name}</text>;
        })}
        {cpx && radiusPx > 0 && (
          <circle cx={cpx.x} cy={cpx.y} r={radiusPx} fill="color-mix(in srgb, var(--brand) 7%, transparent)" stroke="var(--brand)" strokeWidth="1.5" strokeDasharray="6 5" />
        )}
        {upx && (
          <g aria-hidden="true">
            <circle cx={upx.x} cy={upx.y} r="14" fill="color-mix(in srgb, var(--info) 22%, transparent)" />
            <circle cx={upx.x} cy={upx.y} r="6.5" fill="var(--info)" stroke="#fff" strokeWidth="2.5" />
          </g>
        )}
        {clusters.map((cl) => {
          if (cl.items.length > 1) {
            return (
              <g key={cl.items[0].id} className="marker" tabIndex={0} role="button" aria-label={`${cl.items.length} stores here. Zoom in.`}
                onClick={(e) => { e.stopPropagation(); setView({ center: unproject(cl.x - size.w / 2 + c.x, cl.y - size.h / 2 + c.y, v.zoom), zoom: Math.min(16, v.zoom + 1.5) }); }}
                onKeyDown={(e) => e.key === 'Enter' && setView({ center: unproject(cl.x - size.w / 2 + c.x, cl.y - size.h / 2 + c.y, v.zoom), zoom: Math.min(16, v.zoom + 1.5) })}>
                <circle className="ring" cx={cl.x} cy={cl.y} r={15} fill="var(--ink)" stroke="var(--surface)" strokeWidth="3" />
                <text x={cl.x} y={cl.y + 4} textAnchor="middle" fill="var(--bg)" style={{ font: '800 12px var(--font-display)' }}>{cl.items.length}</text>
              </g>
            );
          }
          const m = cl.items[0];
          const sel = m.id === selectedId;
          const color = m.kind ? STORE_TYPE_COLOR[m.kind] ?? 'var(--brand)' : 'var(--brand)';
          return (
            <g key={m.id} className="marker" tabIndex={0} role="button" aria-label={m.title} aria-pressed={sel}
              onClick={(e) => { e.stopPropagation(); onSelect?.(sel ? null : m.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(sel ? null : m.id); } }}
              opacity={m.dim ? 0.45 : 1}>
              <path d={`M${cl.x},${cl.y} l-8,-11 a10,10 0 1 1 16,0 Z`} fill={color} stroke="var(--surface)" strokeWidth="2" transform={sel ? `translate(${cl.x} ${cl.y}) scale(1.3) translate(${-cl.x} ${-cl.y})` : undefined} />
              <circle className="ring" cx={cl.x} cy={cl.y - 17} r="3.6" fill="var(--surface)" stroke="transparent" transform={sel ? `translate(${cl.x} ${cl.y}) scale(1.3) translate(${-cl.x} ${-cl.y})` : undefined} />
              {m.label && (
                <g>
                  <rect x={cl.x + 9} y={cl.y - 30} width={m.label.length * 6.6 + 10} height="17" rx="4" fill="var(--surface)" stroke="var(--line-strong)" />
                  <text x={cl.x + 14} y={cl.y - 18} style={{ font: '800 10.5px var(--font-display)' }} fill="var(--ink)">{m.label}</text>
                </g>
              )}
              <title>{m.title}</title>
            </g>
          );
        })}
      </svg>
      <div className="controls">
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => setView(null)} aria-label="Reset view" style={{ fontSize: 12 }}>⤢</button>
      </div>
      {legend && kinds.length > 1 && (
        <div className="legend" aria-hidden="true">
          {kinds.map((k) => <span key={k}><i style={{ background: STORE_TYPE_COLOR[k] }} />{STORE_TYPE_LABEL[k] ?? k}</span>)}
        </div>
      )}
      <span className="attrib">Schematic map · not to scale for navigation</span>
      {selected && spx && renderPopup && spx.x > 0 && spx.y > 0 && spx.x < size.w && spx.y < size.h && (
        <div className="popup" style={{ left: spx.x, top: spx.y - 14 }}>{renderPopup(selected)}</div>
      )}
    </div>
  );
}
