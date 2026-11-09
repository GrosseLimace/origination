import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SessionReset } from './session-reset.service';

describe('SessionReset', () => {
  it('runs every registered clearing', () => {
    const sessionReset = TestBed.inject(SessionReset);
    const first = vi.fn();
    const second = vi.fn();
    sessionReset.onReset(first);
    sessionReset.onReset(second);

    sessionReset.reset();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no store has registered', () => {
    expect(() => TestBed.inject(SessionReset).reset()).not.toThrow();
  });
});
