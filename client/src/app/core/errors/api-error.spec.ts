import { describe, it, expect } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, categorizeStatus } from './api-error';

function httpError(status: number, error: unknown, statusText = 'Error'): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText, error, url: '/api/thing' });
}

describe('ApiError.fromHttpErrorResponse', () => {
  it('reads every field of the API envelope', () => {
    const err = ApiError.fromHttpErrorResponse(httpError(503, {
      error: {
        code: 'INFRASTRUCTURE_CTRM_UNAVAILABLE',
        message: 'A service dependency is unavailable. Please try again shortly.',
        traceId: 'abc-123',
        timestamp: '2026-10-14T00:00:00Z',
        instance: '/api/contracts'
      }
    }));

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(503);
    expect(err.code).toBe('INFRASTRUCTURE_CTRM_UNAVAILABLE');
    expect(err.message).toBe('A service dependency is unavailable. Please try again shortly.');
    expect(err.traceId).toBe('abc-123');
    expect(err.details).toEqual([]);
    expect(err.category).toBe('server');
  });

  it('prefers the first field-level detail over the generic validation message, and keeps all details', () => {
    const details = [
      { field: 'name', message: '', code: 'VALIDATION_INVALID_FIELD' },
      { field: 'name', message: 'A location named "Dup" already exists.', code: 'VALIDATION_INVALID_FIELD' }
    ];
    const err = ApiError.fromHttpErrorResponse(httpError(400, {
      error: { code: 'VALIDATION_ERROR', message: 'One or more fields failed validation.', details, traceId: 't1' }
    }));

    expect(err.message).toBe('A location named "Dup" already exists.');
    expect(err.details).toEqual(details);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.category).toBe('validation');
  });

  it('falls back to a bare { message } body when there is no envelope', () => {
    const err = ApiError.fromHttpErrorResponse(httpError(409, { message: 'Already excluded' }));
    expect(err.message).toBe('Already excluded');
    expect(err.code).toBeUndefined();
    expect(err.traceId).toBeUndefined();
    expect(err.category).toBe('conflict');
  });

  it('falls back to the HttpErrorResponse message for a non-JSON body', () => {
    const response = httpError(500, '<html>Bad gateway</html>', 'Internal Server Error');
    const err = ApiError.fromHttpErrorResponse(response);
    expect(err.message).toBe(response.message);
    expect(err.status).toBe(500);
    expect(err.code).toBeUndefined();
    expect(err.cause).toBe(response);
  });

  it('treats status 0 (no response reached the browser) as a network failure', () => {
    const err = ApiError.fromHttpErrorResponse(new HttpErrorResponse({
      status: 0, statusText: 'Unknown Error', error: new ProgressEvent('error'), url: '/api/thing'
    }));
    expect(err.status).toBe(0);
    expect(err.category).toBe('network');
    expect(err.message).toBeTruthy();
  });

  it('survives a malformed details field rather than throwing while handling an error', () => {
    const err = ApiError.fromHttpErrorResponse(httpError(400, { error: { message: 'Bad', details: 'nope' } }));
    expect(err.message).toBe('Bad');
    expect(err.details).toEqual([]);
  });
});

describe('ApiError.fromUnknown', () => {
  it('keeps the message of a non-HTTP Error and marks it unknown', () => {
    const cause = new TypeError('boom');
    const err = ApiError.fromUnknown(cause);
    expect(err.message).toBe('boom');
    expect(err.category).toBe('unknown');
    expect(err.cause).toBe(cause);
  });

  it('uses the generic text for a non-Error throw', () => {
    expect(ApiError.fromUnknown('weird').message).toBe('Server error');
  });

  it('returns an ApiError unchanged', () => {
    const original = new ApiError({ message: 'x', status: 404 });
    expect(ApiError.fromUnknown(original)).toBe(original);
  });
});

describe('categorizeStatus', () => {
  it.each([
    [0, 'network'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [400, 'validation'],
    [422, 'validation'],
    [409, 'conflict'],
    [500, 'server'],
    [503, 'server'],
    [429, 'unknown'],
    [499, 'unknown']
  ] as const)('%i -> %s', (status, category) => {
    expect(categorizeStatus(status)).toBe(category);
  });
});
