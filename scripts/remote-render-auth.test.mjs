import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { corsHeaders, createAccessVerifier, createAuthenticator } from './remote-render-auth.mjs';

const TOKEN = 'x'.repeat(40);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] };
const NOW = 1_800_000_000_000;

function jwt(claims, kid = 'k1') {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${part({ alg: 'RS256', kid })}.${part(claims)}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
}

const claims = { iss: 'https://team.cloudflareaccess.com', aud: ['aud-tag'], exp: NOW / 1000 + 60, email: 'Me@Example.com' };
const access = { team: 'team.cloudflareaccess.com', audience: 'aud-tag', fetchJwks: async () => jwks, now: () => NOW };

test('the bearer token must match exactly', async () => {
  assert.throws(() => createAuthenticator({}), /No authentication configured/);
  assert.throws(() => createAuthenticator({ token: 'short' }), /32 characters/);
  const authenticate = createAuthenticator({ token: TOKEN });
  assert.deepEqual(await authenticate({ authorization: `Bearer ${TOKEN}` }), { email: 'token' });
  await assert.rejects(authenticate({ authorization: `Bearer ${TOKEN}y` }), /Invalid bearer token/);
  await assert.rejects(authenticate({}), /Invalid bearer token/);
});

test('Cloudflare Access tokens are checked for signature, application, expiry and allowlist', async () => {
  const verifyAccess = createAccessVerifier({ ...access, emails: ['me@example.com'] });
  assert.deepEqual(await verifyAccess(jwt(claims)), { email: 'Me@Example.com' });
  const forged = jwt(claims).replace(/\.[^.]+$/, `.${Buffer.from('forged').toString('base64url')}`);
  await assert.rejects(verifyAccess(forged), /Invalid Cloudflare Access signature/);
  await assert.rejects(verifyAccess(jwt({ ...claims, aud: ['other'] })), /another application/);
  await assert.rejects(verifyAccess(jwt({ ...claims, iss: 'https://evil.cloudflareaccess.com' })), /another application/);
  await assert.rejects(verifyAccess(jwt({ ...claims, exp: NOW / 1000 - 1 })), /Expired/);
  await assert.rejects(verifyAccess(jwt({ ...claims, email: 'other@example.com' })), /not allowed/);
  await assert.rejects(verifyAccess(jwt(claims, 'unknown')), /Unknown Cloudflare Access signing key/);
  await assert.rejects(verifyAccess(undefined), /Missing/);
});

test('both mechanisms are required when both are configured', async () => {
  const authenticate = createAuthenticator({ token: TOKEN, access });
  const headers = { authorization: `Bearer ${TOKEN}`, 'cf-access-jwt-assertion': jwt(claims) };
  assert.deepEqual(await authenticate(headers), { email: 'Me@Example.com' });
  await assert.rejects(authenticate({ ...headers, 'cf-access-jwt-assertion': undefined }), /Missing/);
  await assert.rejects(authenticate({ ...headers, authorization: undefined }), /bearer/);
});

test('CORS headers are only sent to allowed origins', () => {
  const allowed = ['https://rvaquette.github.io'];
  assert.equal(corsHeaders('https://rvaquette.github.io', allowed)['Access-Control-Allow-Origin'], 'https://rvaquette.github.io');
  assert.equal(corsHeaders('https://evil.github.io', allowed), undefined);
  assert.equal(corsHeaders(undefined, allowed), undefined);
});
