import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SortIconComponent } from './sort-icon.component';
import { SortDirection } from '../../utils/table-sort';

/**
 * Three-state sort glyph shared by the usage dashboard's 15 sortable headers. Pins (through the REAL
 * template) that the arrow only points when THIS column is the active one — a stale direction for
 * another column must leave this header neutral — and that the active header is visually emphasised.
 */

const UP = 'M5 15l7-7 7 7';
const DOWN = 'M19 9l-7 7-7-7';
const NEUTRAL = 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4';

describe('SortIconComponent', () => {
  let fixture: ComponentFixture<SortIconComponent>;

  function render(column: string, activeColumn: string | null, direction: SortDirection): void {
    fixture.componentRef.setInput('column', column);
    fixture.componentRef.setInput('activeColumn', activeColumn);
    fixture.componentRef.setInput('direction', direction);
    fixture.detectChanges();
  }

  const glyph = (): string | null => (fixture.nativeElement as HTMLElement).querySelector('path')?.getAttribute('d') ?? null;
  const spanClasses = (): string[] => Array.from((fixture.nativeElement as HTMLElement).querySelector('span')?.classList ?? []);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SortIconComponent] }).compileComponents();
    fixture = TestBed.createComponent(SortIconComponent);
  });

  it('points up when this column is sorted ascending', () => {
    render('name', 'name', 'asc');
    expect(glyph()).toBe(UP);
  });

  it('points down when this column is sorted descending', () => {
    render('name', 'name', 'desc');
    expect(glyph()).toBe(DOWN);
  });

  it('stays neutral when another column is the active sort, whatever the direction', () => {
    render('name', 'lastSeen', 'asc');
    expect(glyph()).toBe(NEUTRAL);
    render('name', 'lastSeen', 'desc');
    expect(glyph()).toBe(NEUTRAL);
  });

  it('stays neutral when nothing is sorted', () => {
    render('name', null, 'none');
    expect(glyph()).toBe(NEUTRAL);
  });

  it('stays neutral on the active column when the direction is none', () => {
    render('name', 'name', 'none');
    expect(glyph()).toBe(NEUTRAL);
  });

  it('emphasises the active column and mutes the rest', () => {
    render('name', 'name', 'asc');
    expect(spanClasses()).toContain('text-gray-600');

    render('name', 'lastSeen', 'asc');
    expect(spanClasses()).toContain('text-gray-400');
    expect(spanClasses()).not.toContain('text-gray-600');
  });

  it('updates as the table re-sorts (OnPush input changes re-render)', () => {
    render('name', 'name', 'asc');
    expect(glyph()).toBe(UP);

    fixture.componentRef.setInput('direction', 'desc');
    fixture.detectChanges();
    expect(glyph()).toBe(DOWN);

    fixture.componentRef.setInput('activeColumn', 'other');
    fixture.detectChanges();
    expect(glyph()).toBe(NEUTRAL);
  });
});
