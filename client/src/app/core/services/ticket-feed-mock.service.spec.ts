import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TicketFeedMockService } from './ticket-feed-mock.service';

describe('TicketFeedMockService (prototype)', () => {
  it('should keep tickets by the enrollment ID they were assigned, ignoring case and spaces', () => {
    const feed = TestBed.inject(TicketFeedMockService);
    feed.add('CI-2026-000001', 1200);
    feed.add(' ci-2026-000001', 800);
    feed.add('CI-2026-000002', 500);
    expect(feed.forEnrollment('CI-2026-000001').map(t => t.netBushels)).toEqual([1200, 800]);
  });
});
