import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_RETURN_PARAM,
  buildSigninUrl,
  clearAuthReturnMarker,
  isAuthReturnUrl,
} from '../src/services/authRedirect';

test('Accounts sign-in URL preserves Mail destination and marks the return', () => {
  const result = new URL(
    buildSigninUrl(
      'https://accounts.gothwadtech.com/signin?choose=1',
      'https://mail.gothwadtech.com/?folder=inbox#message-1',
    ),
  );
  const next = new URL(result.searchParams.get('next') || '');

  assert.equal(result.origin, 'https://accounts.gothwadtech.com');
  assert.equal(result.pathname, '/signin');
  assert.equal(result.searchParams.get('choose'), '1');
  assert.equal(next.origin, 'https://mail.gothwadtech.com');
  assert.equal(next.searchParams.get('folder'), 'inbox');
  assert.equal(next.searchParams.get(AUTH_RETURN_PARAM), '1');
  assert.equal(next.hash, '#message-1');
});

test('return marker is detected and removed without losing other URL state', () => {
  const returned = 'https://mail.gothwadtech.com/?folder=inbox&__mail_auth_return=1#message-1';
  assert.equal(isAuthReturnUrl(returned), true);

  const clean = new URL(clearAuthReturnMarker(returned));
  assert.equal(clean.searchParams.get(AUTH_RETURN_PARAM), null);
  assert.equal(clean.searchParams.get('folder'), 'inbox');
  assert.equal(clean.hash, '#message-1');
  assert.equal(isAuthReturnUrl(clean.toString()), false);
});
