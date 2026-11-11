import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { RECORD_FORMS, RecordkeepingGroup } from '../fd-cic-recordkeeping';
import { ReviewRecordkeepingComponent } from './review-recordkeeping.component';

const GROUPS: RecordkeepingGroup[] = [
  { key: 'always', title: 'Every field', items: ['Field map or location, with its acres', 'Planting date'] },
  { key: 'noTill', title: 'Staying no-till', items: ['Keep this field no-till at least 4 of every 5 years'] },
];

describe('ReviewRecordkeepingComponent', () => {
  let fixture: ComponentFixture<ReviewRecordkeepingComponent>;

  const norm = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() ?? '';
  const el = () => fixture.nativeElement as HTMLElement;
  const sections = () => [...el().querySelectorAll('section')].map(s => ({
    title: norm(s.querySelector('h5')?.textContent),
    items: [...s.querySelectorAll('li')].map(li => norm(li.textContent)),
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ReviewRecordkeepingComponent);
    fixture.componentRef.setInput('groups', GROUPS);
    fixture.detectChanges();
  });

  it('should tell the originator how long the producer keeps records and what counts as one', () => {
    const [intro, forms] = [...el().querySelectorAll('p')].map(p => norm(p.textContent));

    expect(intro).toBe('Go over these with the producer. They keep them for 5 years and show them to an auditor if asked.');
    expect(forms).toBe(RECORD_FORMS);
  });

  it('should show each group as a section with its title and its records, in order', () => {
    expect(sections()).toEqual([
      { title: 'Every field', items: ['Field map or location, with its acres', 'Planting date'] },
      { title: 'Staying no-till', items: ['Keep this field no-till at least 4 of every 5 years'] },
    ]);
  });

  it('should follow the groups when they change, e.g. once the review settles on a different tillage', () => {
    fixture.componentRef.setInput('groups', GROUPS.slice(0, 1));
    fixture.detectChanges();

    expect(sections().map(s => s.title)).toEqual(['Every field']);
  });
});
