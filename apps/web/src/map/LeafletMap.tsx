import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapViewProps } from './MapView';
import { STORE_TYPE_COLOR } from '../ui/icons';

/** Tile-based provider (OpenStreetMap via Leaflet). Selected with VITE_MAP_PROVIDER=leaflet. */
export default function LeafletMap({ markers, center, radiusMi, user, selectedId, onSelect, renderPopup, ariaLabel, height }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    map.current = L.map(el.current!, { zoomControl: true, attributionControl: true }).setView([center?.lat ?? 32.8, center?.lng ?? -96.8], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current!;
    const g = layer.current!;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    if (center && radiusMi) {
      const c = L.circle([center.lat, center.lng], { radius: radiusMi * 1609.344, color: '#0a6647', weight: 1.5, dashArray: '6 5', fillOpacity: 0.06 }).addTo(g);
      bounds.push(...[c.getBounds().getNorthEast(), c.getBounds().getSouthWest()]);
    }
    if (user) L.circleMarker([user.lat, user.lng], { radius: 7, color: '#fff', weight: 2.5, fillColor: '#1f5aa0', fillOpacity: 1 }).addTo(g);
    for (const mk of markers) {
      const cm = L.circleMarker([mk.lat, mk.lng], { radius: mk.id === selectedId ? 10 : 8, color: '#fff', weight: 2, fillColor: STORE_TYPE_COLOR[mk.kind ?? ''] ?? '#0a6647', fillOpacity: mk.dim ? 0.45 : 1 })
        .addTo(g)
        .bindTooltip(mk.label ? `${mk.title} · ${mk.label}` : mk.title);
      cm.on('click', () => onSelect?.(mk.id));
      if (mk.id === selectedId && renderPopup) {
        const div = document.createElement('div');
        createRoot(div).render(<>{renderPopup(mk)}</>);
        cm.bindPopup(div).openPopup();
      }
      bounds.push([mk.lat, mk.lng]);
    }
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 15 });
  }, [markers, center, radiusMi, user, selectedId, onSelect, renderPopup]);

  return <div ref={el} className="map" role="region" aria-label={ariaLabel} style={{ height: height ?? '100%' }} />;
}
