/// <reference types="vite/client" />
declare const __DEMO_BUILD__: boolean;
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MAP_PROVIDER?: 'schematic' | 'leaflet';
}
