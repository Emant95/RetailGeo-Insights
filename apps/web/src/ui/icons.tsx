import type { SVGProps } from 'react';

const P: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z',
  locate: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.1A7 7 0 0 0 13 5.1V3h-2v2.1A7 7 0 0 0 5.1 11H3v2h2.1a7 7 0 0 0 5.9 5.9V21h2v-2.1a7 7 0 0 0 5.9-5.9H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z',
  cart: 'M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7.2 14h9.9a2 2 0 0 0 1.8-1.1L22 6H5.2l-.9-2H1v2h2l3.6 7.6L5.2 16c-.7 1.3.2 3 1.8 3h12v-2H7l1.1-2Z',
  user: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z',
  bell: 'M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.8V3h-3v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z',
  heart: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2 0 3.4 1 4.3 2.4.9-1.4 2.3-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21Z',
  heartOutline: 'M16.5 4.5c-1.9 0-3.4 1-4.5 2.4-1.1-1.4-2.6-2.4-4.5-2.4C4.2 4.5 2 7.1 2 10.2 2 15.4 12 21 12 21s10-5.6 10-10.8c0-3.1-2.2-5.7-5.5-5.7Zm-4.5 14.2C9 16.8 4 13.2 4 10.2 4 8.2 5.4 6.5 7.5 6.5c1.5 0 2.6.9 3.3 2.1h2.4c.7-1.2 1.8-2.1 3.3-2.1 2.1 0 3.5 1.7 3.5 3.7 0 3-5 6.6-8 8.5Z',
  store: 'M4 4h16l1 5a3 3 0 0 1-2 2.8V20H5v-8.2A3 3 0 0 1 3 9l1-5Zm3 9v5h4v-5H7Zm6 0v5h4v-5h-4Z',
  tag: 'M3 3h8l10 10-8 8L3 11V3Zm4.5 6A1.5 1.5 0 1 0 7.5 6a1.5 1.5 0 0 0 0 3Z',
  box: 'M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.2 6.3 3.1L12 10.5 5.7 7.3 12 4.2ZM5 9l6 3v7.7l-6-3V9Zm8 10.7V12l6-3v7.7l-6 3Z',
  truck: 'M2 5h12v10h1.2a3 3 0 0 1 5.6 0H22v-4l-3-4h-3V5H2v10h.2a3 3 0 0 1 5.6 0H14V7H2V5Zm16 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  swap: 'M7 4 3 8l4 4V9h10V7H7V4Zm10 8v3H7v2h10v3l4-4-4-4Z',
  chart: 'M4 20V10h3v10H4Zm6 0V4h3v16h-3Zm6 0v-7h3v7h-3Z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-7 2c-3.3 0-7 1.7-7 4v3h14v-3c0-2.3-3.7-4-7-4Zm7 0c-.5 0-1 0-1.5.1 1.5.9 2.5 2.2 2.5 3.9v3h6v-3c0-2.3-3.7-4-7-4Z',
  gear: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.3-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5-2.1-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
  home: 'M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z',
  list: 'M4 6h2v2H4V6Zm4 0h12v2H8V6Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Z',
  map: 'm15 4-6-2-6 2v18l6-2 6 2 6-2V2l-6 2Zm-1 15.6-4-1.3V4.4l4 1.3v13.9Z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.6 8 11 4.6-1.4 8-6 8-11V5l-8-3Zm-1 14-4-4 1.4-1.4L11 13.2l4.6-4.6L17 10l-6 6Z',
  doc: 'M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM8 12h8v2H8v-2Zm0 4h8v2H8v-2Z',
  flag: 'M5 3v18h2v-7h6l1 2h6V5h-6l-1-2H5Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  x: 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
  minus: 'M5 11h14v2H5z',
  menu: 'M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z',
  chevron: 'M9 6l6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6L9 6Z',
  back: 'M15 6 9 12l6 6 1.4-1.4-4.6-4.6 4.6-4.6L15 6Z',
  upload: 'M5 20h14v-2H5v2Zm7-16-5 5h3v6h4V9h3l-5-5Z',
  mail: 'M3 5h18v14H3V5Zm9 7 7-5H5l7 5Zm0 2L5 9v8h14V9l-7 5Z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3.5 2.1-1 1.7L11 13V6h2v6.4Z',
  phone: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2Z',
  external: 'M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H5v12h12v-6h2v8H3V5h2Z',
  logout: 'M10 17v-3H3v-4h7V7l5 5-5 5Zm4-14h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6v-2h5V5h-5V3Z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5 1.5 3h-3L12 2Zm0 20-1.5-3h3L12 22ZM2 12l3-1.5v3L2 12Zm20 0-3 1.5v-3L22 12Z',
  alert: 'M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
  basket: 'M5.5 9 9.4 3.2l1.7 1.1L7.9 9h8.2l-3.2-4.7 1.7-1.1L18.5 9H22l-2 11H4L2 9h3.5Zm2.5 3v5h2v-5H8Zm6 0v5h2v-5h-2Z',
  pill: 'M4.2 12.8a5 5 0 0 1 7.1-7.1l7 7a5 5 0 0 1-7.1 7.1l-7-7Zm1.4-1.4 3.5 3.5 5.6-5.6-3.5-3.5a3 3 0 0 0-4.2 0 3 3 0 0 0-1.4 5.6Z',
  car: 'M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11a2 2 0 0 1 2 2v5h-2v2h-3v-2H8v2H5v-2H3v-5a2 2 0 0 1 2-2Zm2.2 0h9.6l-1.2-4H8.4l-1.2 4ZM6.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  baby: 'M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Zm-6 12c0-1.7 2.7-3 6-3s6 1.3 6 3v6H6v-6Z',
  paw: 'M8.5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM4 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm16 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-8 3c3 0 6 4.5 6 7a3 3 0 0 1-3 3c-1.2 0-2-.6-3-.6s-1.8.6-3 .6a3 3 0 0 1-3-3c0-2.5 3-7 6-7Z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  fuel: 'M4 3h9v18H4V3Zm2 2v5h5V5H6Zm9 3 2-2 3 3v9a2 2 0 0 1-4 0v-4h-1v-2h1a2 2 0 0 1 2 2v4h0V9.8l-1.5-1.5L15 8Z',
  cross: 'M9 2h6v7h7v6h-7v7H9v-7H2V9h7V2Z',
  star: 'M12 2 9 9H2l5.6 4.3L5.5 21 12 16.5 18.5 21l-2.1-7.7L22 9h-7l-3-7Z',
  bag: 'M7 7V6a5 5 0 0 1 10 0v1h3l1 15H3L4 7h3Zm2 0h6V6a3 3 0 0 0-6 0v1Z',
};

export type IconName = keyof typeof P;
export const ICON_PATHS = P;

export function Icon({ name, className = 'icon', title, ...rest }: { name: IconName; className?: string; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} fill="currentColor" {...rest}>
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}

export const STORE_TYPE_ICON: Record<string, IconName> = {
  grocery: 'basket', convenience: 'bag', gas_station: 'fuel', pharmacy: 'cross', specialty: 'star', retail: 'home',
};
export const STORE_TYPE_COLOR: Record<string, string> = {
  grocery: '#0a6647', convenience: '#1f5aa0', gas_station: '#b4541a', pharmacy: '#a3246b', specialty: '#6b4fb3', retail: '#4a5a2a',
};
