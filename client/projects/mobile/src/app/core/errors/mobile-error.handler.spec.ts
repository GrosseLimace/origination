import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { messageFor } from './mobile-error.handler';

describe('messageFor', () => {
  const http = (status: number) => new HttpErrorResponse({ status, statusText: 'x', error: { message: 'server detail that must not leak' } });

  it('never shows server text to the user', () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
      expect(messageFor(http(status))).not.toContain('server detail');
    }
  });

  it('maps the statuses the phone can act on', () => {
    expect(messageFor(http(0))).toMatch(/No connection/);
    expect(messageFor(http(404))).toMatch(/not in your trade units/);
    expect(messageFor(http(409))).toMatch(/Someone else changed/);
    expect(messageFor(http(503))).toMatch(/waking up/);
  });

  it('stays silent on lazy-chunk and MSAL interaction noise', () => {
    expect(messageFor(new Error('ChunkLoadError: Loading chunk 3 failed'))).toBeNull();
    expect(messageFor(new Error('interaction_in_progress'))).toBeNull();
  });

  it('unwraps unhandled promise rejections', () => {
    expect(messageFor({ rejection: http(409) })).toMatch(/Someone else changed/);
  });
});
