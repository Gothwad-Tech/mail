import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_RETURN_PARAM,
  buildSigninUrl,
  clearAuthReturnMarker,
  isAuthReturnUrl,
} from '../src/services/authRedirect';
import { classifySessionFailure, sessionErrorMessage } from '../src/hooks/useSession';
import { ApiError } from '../src/services/mailApi';

const SIGNIN = 'https://accounts.gothwadtech.com/signin?choose=1';
const PROFILE_MESSAGE =
  'Your Gothwad Account is signed in, but Mail could not load your profile. Try again in a minute, or contact the admin.';

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

// -----------------------------------------------------------------------------
// /api/session failures. Only a real signed-out 401 may start the Accounts
// round-trip. The 503 codes (Accounts answered, but Mail cannot read the
// session) must show a retry message instead of looping the chooser.
// -----------------------------------------------------------------------------

test('only a 401 with a signinUrl starts the Accounts round-trip', () => {
  const signedOut = new ApiError(401, 'unauthenticated', 'Please sign in.', SIGNIN);
  assert.deepEqual(classifySessionFailure(signedOut, false), { kind: 'redirect', signinUrl: SIGNIN });

  // A 401 without a signinUrl is a Worker misconfiguration: no redirect.
  const noUrl = new ApiError(401, 'unauthenticated', 'Please sign in.');
  assert.equal(classifySessionFailure(noUrl, false).kind, 'error');

  // Same 401 after coming back from Accounts: explain, do not loop.
  assert.equal(classifySessionFailure(signedOut, true).kind, 'return-error');
});

test('a 503 never redirects to Accounts, even if it carries a signinUrl', () => {
  for (const code of ['accounts_user_invalid', 'accounts_unexpected_response', 'auth_unavailable']) {
    // The signinUrl is passed on purpose: a 503 must still not be converted
    // into a redirect by the hook.
    const err = new ApiError(503, code, 'Accounts said something odd.', SIGNIN);
    const failure = classifySessionFailure(err, false);
    assert.equal(failure.kind, 'error', `${code} must be shown with Retry`);
    assert.equal(failure.kind === 'error' ? failure.message.includes('Redirecting') : true, false);
  }

  // Network errors (status 0) are local errors too.
  const network = new ApiError(0, 'network', 'Cannot reach Gothwad Mail right now.');
  assert.equal(classifySessionFailure(network, false).kind, 'error');
});

test('503 profile failures use the signed-in wording, not the expired-cookie wording', () => {
  const invalid = new ApiError(503, 'accounts_user_invalid', 'Accounts ignored user.username.');
  const unexpected = new ApiError(503, 'accounts_unexpected_response', 'Accounts answered with HTML.');
  assert.equal(sessionErrorMessage(invalid), PROFILE_MESSAGE);
  assert.equal(sessionErrorMessage(unexpected), PROFILE_MESSAGE);
  assert.equal(sessionErrorMessage(unexpected).includes('cookie'), false, 'no cookie talk for a 503');

  // Accounts being down keeps its own retryable message.
  const down = new ApiError(503, 'auth_unavailable', 'Accounts is not reachable right now.');
  assert.equal(sessionErrorMessage(down), 'Accounts is not reachable right now.');
  assert.equal(sessionErrorMessage(new Error('boom')), 'boom');
});
