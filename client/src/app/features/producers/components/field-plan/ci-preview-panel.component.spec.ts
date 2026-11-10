import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FdCicScoreState } from '@models';
import { fakeFdCicApi } from './programs/fd-cic/fd-cic.testing';
import { CiPreviewPanelComponent } from './ci-preview-panel.component';

const request = (crop: string) => ({
  crop, state: 'KS', county: 'Pratt', actualYield: null, expectedYield: 200, syntheticN: 180, niFraction: 0,
  coverCrop: 'No cover crop', tillage: 'No till', manure: [],
});
const scoreFor = (crop: string) => fakeFdCicApi().score(2026, request(crop)) as Extract<FdCicScoreState, { status: 'done' }>;

/** Whitespace dropped: the markup puts no spaces between a label and its number. */
const squash = (s: string) => s.replace(/\s+/g, '');

describe('CiPreviewPanelComponent', () => {
  let text: () => string;
  let setState: (state: FdCicScoreState) => void;

  beforeEach(() => {
    const fixture = TestBed.createComponent(CiPreviewPanelComponent);
    setState = state => {
      fixture.componentRef.setInput('state', state);
      fixture.detectChanges();
    };
    text = () => squash((fixture.nativeElement as HTMLElement).textContent!);
  });

  it('should show each component\'s adjustable part with the inputs that move it', () => {
    setState(scoreFor('Corn'));
    expect(text()).toContain(squash('Changed by this field\'s inputs'));
    expect(text()).toContain(squash('Soil carbon (credit) -500 Tillage, Cover crop, County'));
    // On-farm energy 800 with 300 fixed: 500 is what tillage and cover crop drive.
    expect(text()).toContain(squash('On-farm energy 500 Tillage, Cover crop'));
  });

  it('should keep the fixed USDA figures apart, never among the adjustable ones', () => {
    setState(scoreFor('Corn'));
    const [adjustable, defaults] = text().split(squash('USDA defaults (no input changes these)'));
    expect(adjustable).not.toContain(squash('Other chemicals'));
    expect(defaults).toContain(squash('🔒 Other on-farm energy 300'));
    expect(defaults).toContain(squash('🔒 Other chemicals 470'));
    expect(defaults).toContain(squash('🔒 Lime 60'));
    expect(defaults).toContain(squash('The calculator has no input for these.'));
    expect(text()).not.toContain(squash('Soybean N fixation'));
  });

  it('should say which components each choice moves', () => {
    setState(scoreFor('Corn'));
    expect(text()).toContain(squash('No till −600 Soil carbon (credit) −500 · On-farm energy −100'));
  });

  it('should mark only the rows an edit moved, and never a USDA default', () => {
    setState(scoreFor('Corn'));
    expect(text()).not.toContain('Changefromyourlastedit');
    // More N: the fake moves only urea & lime's adjustable part (N fertilizer etc. are fixed in the fake).
    const moreN = fakeFdCicApi().score(2026, { ...request('Corn'), syntheticN: 220 });
    setState(moreN);
    const [adjustable, rest] = text().split(squash('USDA defaults'));
    const defaults = rest.split(squash('What\'s moving the score'))[0];
    expect(adjustable).toContain(squash('Urea & lime +200'));
    expect(adjustable).not.toContain(squash('Soil carbon (credit) +'));
    expect(adjustable).not.toContain(squash('Soil carbon (credit) −'));
    expect(defaults).not.toMatch(/[+−]\d/);
  });

  it('should list soybean N fixation as a USDA default for soybeans', () => {
    setState(scoreFor('Soybean'));
    expect(text().split(squash('USDA defaults'))[1]).toContain(squash('🔒 Soybean N fixation 300'));
  });
});
