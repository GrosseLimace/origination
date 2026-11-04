import { describe, it, expect } from 'vitest';
import { enrollmentIdFor } from './program-enrollment';

describe('enrollmentIdFor', () => {
  it('should derive a field\'s ID from the program prefix, crop year and split ID, the same every time', () => {
    expect(enrollmentIdFor('CI', 2026, 'TATOB43')).toBe('CI-2026-TATOB43');
    expect(enrollmentIdFor('CI', 2026, ' tatob43 ')).toBe('CI-2026-TATOB43');
    expect(enrollmentIdFor('CI', 2027, 'TATOB43')).toBe('CI-2027-TATOB43');
  });
});
