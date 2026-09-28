import { useId } from 'react';

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const shortDay = (d: string) => {
  const dt = new Date(`${d}T12:00:00`);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Daily bars with a faint grid; the last (today) bar is emphasized. */
export function BarChart({ data, format = (v) => String(v), height = 180, label }: { data: { day: string; value: number }[]; format?: (v: number) => string; height?: number; label: string }) {
  const W = 640;
  const H = height;
  const pad = { l: 52, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const every = Math.ceil(data.length / 7);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', height: 'auto' }}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid-l" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end">{format(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const h = Math.max(0, H - pad.b - y(d.value));
        return (
          <g key={d.day}>
            <rect className={`bar ${i === data.length - 1 ? '' : 'dim'}`} x={pad.l + i * bw + bw * 0.15} y={H - pad.b - h} width={bw * 0.7} height={h} rx="2">
              <title>{`${shortDay(d.day)}: ${format(d.value)}`}</title>
            </rect>
            {(i % every === 0 || i === data.length - 1) && <text x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle">{i === data.length - 1 ? 'Today' : shortDay(d.day)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** Area + line trend with an emphasized endpoint. */
export function AreaChart({ data, format = (v) => String(v), height = 180, label }: { data: { day: string; value: number }[]; format?: (v: number) => string; height?: number; label: string }) {
  const id = useId();
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 14, t: 14, b: 26 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const last = data[data.length - 1];
  const every = Math.ceil(data.length / 7);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', height: 'auto' }} aria-describedby={id}>
      <desc id={id}>{data.map((d) => `${shortDay(d.day)} ${format(d.value)}`).join(', ')}</desc>
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line className="grid-l" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end">{format(t)}</text>
        </g>
      ))}
      <path className="area" d={area} />
      <path className="line" d={line} />
      {last && <circle className="pt" cx={x(data.length - 1)} cy={y(last.value)} r="4.5" />}
      {data.map((d, i) => (i % every === 0 || i === data.length - 1) && <text key={d.day} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{i === data.length - 1 ? 'Today' : shortDay(d.day)}</text>)}
    </svg>
  );
}

/** Horizontal proportion bars for ranked lists. */
export function RankBars({ rows, format = (v) => String(v) }: { rows: { label: string; value: number; sub?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack tight">
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 12px', alignItems: 'center' }}>
          <span className="small ellipsis" title={r.label}>{r.label}</span>
          <span className="small num" style={{ fontWeight: 600 }}>{format(r.value)}</span>
          <div className="bar-inline" style={{ gridColumn: '1 / -1' }}><span style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Conversion funnel as stepped bars. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="stack tight">
      {steps.map((s, i) => (
        <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr) 90px', gap: 10, alignItems: 'center' }}>
          <span className="small">{s.label}</span>
          <div className="bar-inline" style={{ height: 14 }}><span style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, opacity: 1 - i * 0.12 }} /></div>
          <span className="small num r" style={{ textAlign: 'right' }}>{s.value.toLocaleString()}{i > 0 && steps[i - 1].value ? <span className="faint"> · {Math.round((s.value / steps[i - 1].value) * 100)}%</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
