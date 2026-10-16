const ALLOWED_ORIGINS = [
  'https://pitterpotter.co.uk',
  'https://www.pitterpotter.co.uk',
  'https://pitterpotter.netlify.app',
];

const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// Private-LAN dev preview (e.g. iPad on the same wifi opening
// http://192.168.x.x:3000 against `vite --host`). Only port 3000.
const LAN_DEV_ORIGIN = /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):3000$/;

function getOrigin(req: Request): string | null {
  return req.headers.get('Origin') || req.headers.get('origin');
}

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (LOCAL_ORIGINS.includes(origin)) return true;
  if (LAN_DEV_ORIGIN.test(origin)) return true;
  return false;
}

export function corsHeaders(req: Request, admin = false): Record<string, string> {
  const origin = getOrigin(req);
  const allowOrigin = admin
    ? (origin && isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0])
    : '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    ...(admin && origin ? { 'Vary': 'Origin' } : {}),
  };
}

export function optionsResponse(req: Request, admin = false): Response {
  return new Response('ok', { headers: corsHeaders(req, admin) });
}
