import { describe, it, expect } from 'vitest';
import { recordkeepingFor } from './fd-cic-recordkeeping';

describe('recordkeepingFor (what the producer keeps)', () => {
  const plain = { niFraction: 0, manure: [], coverCrop: 'None' as const };

  it('should list only the every-field records for a field with no practices', () => {
    expect(recordkeepingFor(plain, 'NoneOfTheAbove').map(g => g.key)).toEqual(['always']);
  });

  it('should add a group for each practice the inputs claim', () => {
    const groups = recordkeepingFor({
      niFraction: 0.5, coverCrop: 'CoverCrop',
      manure: [{ type: 'Beef', form: 'Solid', amount: 10, nContent: 12 }],
    }, 'ReducedTill');

    expect(groups.map(g => g.key)).toEqual(['always', 'inhibitor', 'manure', 'coverCrop', 'tillage']);
    expect(groups.find(g => g.key === 'tillage')!.items.join(' ')).toContain('T-DISC');
  });

  it('should name the documents and what each must show, as 7 CFR 2100 asks', () => {
    const always = recordkeepingFor(plain, 'NoneOfTheAbove')[0].items.join(' ');
    expect(always).toContain('standard moisture (corn 15.5%');
    expect(always).toContain('buyer, date');
    expect(always).toContain('written before any fertilizer');
    expect(always).toContain('soil test from the last 2 years (results, lab');

    const tillage = recordkeepingFor(plain, 'ReducedTill').find(g => g.key === 'tillage')!.items.join(' ');
    expect(tillage).toContain('depth and width');
    expect(tillage).toContain('average speed');
  });

  it('should ask for grazing photos only for a grazed cover crop', () => {
    const cover = (c: 'CoverCrop' | 'CoverCropGrazed') => recordkeepingFor({ ...plain, coverCrop: c }, 'NoneOfTheAbove').find(g => g.key === 'coverCrop')!.items.join(' ');
    expect(cover('CoverCrop')).not.toContain('grazed');
    expect(cover('CoverCropGrazed')).toContain('being grazed');
  });

  it('should add the 4-of-5-years promise for no till only', () => {
    expect(recordkeepingFor(plain, 'NoTill').map(g => g.key)).toEqual(['always', 'tillage', 'noTill']);
    expect(recordkeepingFor(plain, 'ReducedTill').map(g => g.key)).not.toContain('noTill');
  });
});
