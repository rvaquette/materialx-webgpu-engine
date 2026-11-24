// Request authentication of the remote render server (scripts/remote-render-server.mjs):
// a shared bearer token and/or the Cloudflare Access JWT that the tunnel adds to every request.
import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';

const JWKS_TTL_MS = 60 * 60 * 1000;

function base64UrlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function sameSecret(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies a Cloudflare Access application token (RS256, signed by the team's keys):
 * issuer, audience tag, validity period and optionally the e-mail allowlist.
 */
export function createAccessVerifier({ team, audience, emails = [], fetchJwks, now = () => Date.now() }) {
  const issuer = `https://${team.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  const allowed = new Set(emails.map(email => email.toLowerCase()));
  const loadJwks = fetchJwks ?? (async () => {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error(`Cloudflare Access certificates: HTTP ${response.status}`);
    return response.json();
  });
  let cache;
  async function key(kid) {
    for (const refresh of [false, true]) {
      if (refresh || !cache || now() - cache.time > JWKS_TTL_MS) {
        const jwks = await loadJwks();
        cache = { time: now(), keys: new Map((jwks.keys ?? []).filter(jwk => jwk.kid).map(jwk => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])) };
      }
      const found = cache.keys.get(kid);
      if (found) return found;
    }
    throw new Error('Unknown Cloudflare Access signing key.');
  }
  return async (token) => {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new Error('Missing Cloudflare Access token.');
    const header = base64UrlJson(parts[0]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported Cloudflare Access token.');
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!verify('RSA-SHA256', signed, await key(header.kid), Buffer.from(parts[2], 'base64url'))) {
      throw new Error('Invalid Cloudflare Access signature.');
    }
    const claims = base64UrlJson(parts[1]);
    const seconds = now() / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audiences.includes(audience)) throw new Error('Cloudflare Access token for another application.');
    if (typeof claims.exp !== 'number' || claims.exp <= seconds || (typeof claims.nbf === 'number' && claims.nbf > seconds + 60)) {
      throw new Error('Expired Cloudflare Access token.');
    }
    if (allowed.size && !allowed.has(String(claims.email ?? '').toLowerCase())) throw new Error('User not allowed.');
    return { email: claims.email ?? claims.common_name ?? 'service-token' };
  };
}

/**
 * Returns `authenticate(headers)`, resolving to the user or throwing. Every configured
 * mechanism must pass: the bearer token (MX_REMOTE_TOKEN) and the Cloudflare Access JWT.
 */
export function createAuthenticator({ token, access }) {
  if (!token && !access) throw new Error('No authentication configured: set MX_REMOTE_TOKEN and/or MX_REMOTE_ACCESS_TEAM + MX_REMOTE_ACCESS_AUD.');
  if (token !== undefined && token.length < 32) throw new Error('MX_REMOTE_TOKEN must be at least 32 characters.');
  const verifyAccess = access && createAccessVerifier(access);
  return async (headers) => {
    let user = { email: 'token' };
    if (token) {
      const match = /^Bearer (.+)$/.exec(headers.authorization ?? '');
      if (!match || !sameSecret(match[1], token)) throw new Error('Invalid bearer token.');
    }
    if (verifyAccess) user = await verifyAccess(headers['cf-access-jwt-assertion']);
    return user;
  };
}

/** CORS: only the listed web origins (e.g. https://rvaquette.github.io) may call the server. */
export function corsHeaders(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.includes(origin)) return undefined;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
