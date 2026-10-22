import { describe, it, expect } from 'vitest';
import { FieldSeason, ProducerField } from '@models';
import { GRAINCRAFT_PROGRAM } from './graincraft.program';

const season: FieldSeason = { id: 's1', fieldKey: 'f1', plantingIntentionId: 1, year: 2026, cropLabel: 'Hard Red Winter Wheat', acres: 160 };
const field: ProducerField = { fieldKey: 'f1', customerId: 9, name: 'Home quarter', fsaFarmNo: '1234', fsaTractNo: '5678', fsaFieldNo: '2', state: 'KS', county: 'Pratt' };

describe('GrainCraft program', () => {
  it('should apply to wheat only', () => {
    expect(GRAINCRAFT_PROGRAM.appliesTo('Hard Red Winter Wheat')).toBe(true);
    expect(GRAINCRAFT_PROGRAM.appliesTo('Organic Wheat')).toBe(true);
    expect(GRAINCRAFT_PROGRAM.appliesTo('Corn')).toBe(false);
  });

  it('should need only the variety, and show it on the field\'s chip', () => {
    expect(GRAINCRAFT_PROGRAM.missing({ variety: ' ' }, season)).toEqual(['wheat variety']);
    expect(GRAINCRAFT_PROGRAM.missing({ variety: 'SY Monument' }, season)).toEqual([]);
    expect(GRAINCRAFT_PROGRAM.chipText!({ variety: 'SY Monument' })).toBe('SY Monument');
    expect(GRAINCRAFT_PROGRAM.preview({ variety: 'SY Monument' }, season, field)).toBeNull();
  });

  it('should carry the variety to the next wheat year only', () => {
    expect(GRAINCRAFT_PROGRAM.copyForward({ variety: 'Zenda' }, 'Hard Red Winter Wheat', 'Hard Red Winter Wheat')).toEqual({ variety: 'Zenda' });
    expect(GRAINCRAFT_PROGRAM.copyForward({ variety: 'Zenda' }, 'Corn', 'Hard Red Winter Wheat')).toBeNull();
  });

  it('should have no producer-level enrollment, and freeze the variety with the field', () => {
    expect(GRAINCRAFT_PROGRAM.enrollment).toBeUndefined();
    expect(GRAINCRAFT_PROGRAM.freeze({ variety: 'Zenda' }, season, field).inputs).toMatchObject({ variety: 'Zenda', fsaFieldNo: '2', acres: 160 });
  });
});
