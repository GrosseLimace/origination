import { describe, expect, it } from 'vitest';
import {
  hasOrganicIndustryCode,
  hasOrganicNopId,
  isOrganicSectionVisible,
  organicVisibility,
  ORGANIC_VISIBILITY_RULES,
  type OrganicVisibilitySubject,
} from './organic-visibility';

describe('organic-visibility', () => {
  describe('industry code (condition 1)', () => {
    it('matches the organic code exactly', () => {
      expect(hasOrganicIndustryCode({ industryCode2: 'OR' })).toBe(true);
    });

    it('tolerates casing and padding, because the source column is neither', () => {
      expect(hasOrganicIndustryCode({ industryCode2: 'or' })).toBe(true);
      expect(hasOrganicIndustryCode({ industryCode2: ' OR ' })).toBe(true);
    });

    it('is not a substring match', () => {
      // 'ORG' and 'FOR' both contain OR. Real codes seen on organic-adjacent producers include
      // 'CV' (conventional) and 'DA' (dairy) — none of them should qualify.
      for (const code of ['ORG', 'FOR', 'CV', 'DA', 'PR', '']) {
        expect(hasOrganicIndustryCode({ industryCode2: code })).toBe(false);
      }
      expect(hasOrganicIndustryCode({ industryCode2: null })).toBe(false);
      expect(hasOrganicIndustryCode({})).toBe(false);
    });
  });

  describe('NOP id (condition 2)', () => {
    it('counts a real id as present', () => {
      expect(hasOrganicNopId({ nopId: '1234567890' })).toBe(true);
    });

    it('treats absent or blank as missing', () => {
      expect(hasOrganicNopId({ nopId: null })).toBe(false);
      expect(hasOrganicNopId({ nopId: '' })).toBe(false);
      expect(hasOrganicNopId({ nopId: '   ' })).toBe(false);
      expect(hasOrganicNopId({})).toBe(false);
    });

    // Placeholder rejection ('0', '999999999') is the SERVER's job — OdsValues.NormaliseNopId. By the
    // time a value reaches the client it is already real, so the client does not re-litigate it.
  });

  describe('the two conditions OR together', () => {
    it('shows on the industry code alone', () => {
      const result = organicVisibility({ industryCode2: 'OR' });
      expect(result.visible).toBe(true);
      expect(result.reasons).toEqual(['industry-code']);
    });

    it('shows on a NOP id alone — the five real producers this exists for', () => {
      // Measured 2026-09-21: five producers in trade unit 2080 hold real NOP ids while coded 'CV'
      // or 'DA'. Without this condition they would show nothing.
      const result = organicVisibility({ industryCode2: 'CV', nopId: '1234567890' });
      expect(result.visible).toBe(true);
      expect(result.reasons).toEqual(['nop-id']);
    });

    it('reports both reasons when both fire — the overwhelmingly common case', () => {
      const result = organicVisibility({ industryCode2: 'OR', nopId: '9876543210' });
      expect(result.reasons).toEqual(['industry-code', 'nop-id']);
    });

    it('hides when neither fires', () => {
      const result = organicVisibility({ industryCode2: 'CV', nopId: null });
      expect(result.visible).toBe(false);
      expect(result.reasons).toEqual([]);
    });

    it('hides for a producer with nothing set at all', () => {
      expect(isOrganicSectionVisible({})).toBe(false);
    });
  });

  describe('each rule can be retired independently', () => {
    it('drops the industry-code condition when switched off', () => {
      const rules = { ...ORGANIC_VISIBILITY_RULES, industryCode: false };
      expect(isOrganicSectionVisible({ industryCode2: 'OR' }, rules)).toBe(false);
      expect(isOrganicSectionVisible({ industryCode2: 'OR', nopId: '1234567890' }, rules)).toBe(true);
    });

    it('drops the NOP-id condition when switched off', () => {
      const rules = { ...ORGANIC_VISIBILITY_RULES, nopId: false };
      expect(isOrganicSectionVisible({ nopId: '1234567890' }, rules)).toBe(false);
      expect(isOrganicSectionVisible({ industryCode2: 'OR' }, rules)).toBe(true);
    });

    it('hides everything with both rules off', () => {
      const rules = { industryCode: false, nopId: false };
      expect(isOrganicSectionVisible({ industryCode2: 'OR', nopId: '1234567890' }, rules)).toBe(false);
    });
  });

  it('ignores anything that is not a producer fact — the gate has no viewer input', () => {
    // Guards the 2026-09-16 decision to drop trade-unit gating. This replaced an arity check
    // (`isOrganicSectionVisible.length <= 2`) that could never fail — a defaulted parameter does
    // not count toward Function.length, so it asserted 1 <= 2. Assert the behaviour instead:
    // viewer-shaped data must not change the outcome.
    const producer: OrganicVisibilitySubject = { industryCode2: 'CV', nopId: null };
    const withViewer = {
      ...producer,
      viewerTradeUnits: ['2080'],
      viewerIsOrganicDesk: true,
    } as OrganicVisibilitySubject;

    expect(isOrganicSectionVisible(withViewer)).toBe(isOrganicSectionVisible(producer));
    expect(isOrganicSectionVisible(withViewer)).toBe(false);
  });
});
