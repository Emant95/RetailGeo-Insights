import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLocation as useSearchLocation, useSession, toast } from '../state/store';
import { useDebounced } from '../lib/hooks';
import { Icon } from '../ui/icons';
import { Modal } from '../ui/kit';

const RADII = [2, 5, 10, 25, 50];

/**
 * Location selection. Privacy-by-design: device location is requested only on an explicit tap,
 * used as the current *search* location in this browser session, and never saved as an address.
 */
export function LocationPicker({ onClose }: { onClose: () => void }) {
  const { location, radius, setLocation, setRadius } = useSearchLocation();
  const user = useSession((s) => s.user);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [results, setResults] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (dq.trim().length < 2) return setResults([]);
    api.get('/locations/geocode', { q: dq }).then(setResults).catch(() => setResults([]));
  }, [dq]);
  useEffect(() => {
    if (user) api.get('/users/me/addresses').then(setSaved).catch(() => undefined);
  }, [user]);

  const choose = (lat: number, lng: number, label: string, source: 'device' | 'search' | 'saved') => {
    setLocation({ lat, lng, label, source });
    toast({ tone: 'ok', title: 'Location updated', body: label });
    onClose();
  };

  const useDevice = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) return setGeoError('This browser cannot share location. Enter a ZIP code instead.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try {
          const r = await api.get('/locations/reverse', { lat, lng });
          choose(lat, lng, `Near ${r.label}`, 'device');
        } catch {
          setGeoError('RetailGeo beta serves Dallas–Fort Worth, Houston and Austin. Enter a ZIP code in one of those areas.');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setGeoError('Location access was blocked. Enter a ZIP code or city instead.');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  return (
    <Modal title="Where are you shopping?" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="stack">
        <div className="panel row between">
          <div className="row tight nowrap" style={{ minWidth: 0 }}>
            <Icon name="pin" />
            <div style={{ minWidth: 0 }}>
              <div className="xsmall faint">Searching near</div>
              <strong className="ellipsis" style={{ display: 'block' }}>{location.label}</strong>
            </div>
          </div>
        </div>

        <button className="btn block" onClick={useDevice} disabled={locating}>
          <Icon name="locate" /> {locating ? 'Finding you…' : 'Use my current location'}
        </button>
        {geoError && <div className="alert warn small">{geoError}</div>}
        <p className="xsmall faint" style={{ marginTop: -8 }}>Your device location is only used for this search session. We store searches with an approximate area (about 1 km), never your exact position.</p>

        <div className="field">
          <label htmlFor="loc-q">City, neighborhood or ZIP code</label>
          <input id="loc-q" className="input" placeholder="e.g. 75214, Plano, Montrose" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="postal-code" />
        </div>
        {results.length > 0 && (
          <div className="card divider-list" role="listbox" aria-label="Matching places">
            {results.map((r) => (
              <button key={r.label} role="option" aria-selected={false} className="srow" style={{ gridTemplateColumns: '24px 1fr', width: '100%', border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }} onClick={() => choose(r.lat, r.lng, r.label, 'search')}>
                <Icon name="pin" className="icon sm" />
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        )}
        {dq.length >= 2 && results.length === 0 && <p className="small muted">No match in the beta markets. Try a Dallas–Fort Worth, Houston or Austin ZIP code.</p>}

        {saved.length > 0 && (
          <div className="stack tight">
            <span className="eyebrow">Saved locations</span>
            <div className="row tight">
              {saved.filter((a) => a.latitude != null).map((a) => (
                <button key={a.id} className="chip" onClick={() => choose(a.latitude, a.longitude, `${a.label}: ${a.line1}, ${a.city}`, 'saved')}>{a.label} · {a.zip}</button>
              ))}
            </div>
          </div>
        )}

        <div className="stack tight">
          <span className="eyebrow" id="radius-l">Search radius</span>
          <div className="segmented" role="group" aria-labelledby="radius-l">
            {RADII.map((r) => <button key={r} aria-pressed={radius === r} onClick={() => setRadius(r)}>{r} mi</button>)}
          </div>
        </div>
      </div>
    </Modal>
  );
}
