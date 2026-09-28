import { ApiClient } from './client';
import { HttpTransport, type Transport } from './transport';
import { DemoTransport } from './demo';

const apiUrl = import.meta.env.VITE_API_URL;
export const isDemo = __DEMO_BUILD__ || !apiUrl;
export const transport: Transport = isDemo ? new DemoTransport() : new HttpTransport(apiUrl!);
export const api = new ApiClient(transport);
export const demo = isDemo ? (transport as DemoTransport) : null;
export { ApiError } from './client';
