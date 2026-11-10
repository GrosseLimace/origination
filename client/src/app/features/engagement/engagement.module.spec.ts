import { describe, it, expect } from 'vitest';
import { engagementModule } from './engagement.module';
import { FollowUpsPanelComponent } from './components/follow-ups-panel/follow-ups-panel.component';
import { NotesPanelComponent } from './components/notes-panel/notes-panel.component';

const panels = () => engagementModule.customerPanels ?? [];
const panel = (id: string) => panels().find(p => p.id === id)!;

describe("Engagement module: the customer screen's sidebar", () => {
  it('contributes My follow-ups above Notes to the sidebar, for every customer', () => {
    expect(panels().map(p => [p.slot, p.id, p.order])).toEqual([
      ['sidebar', 'follow-ups', 10],
      ['sidebar', 'notes', 20],
    ]);
    expect(panels().every(p => !p.segments?.length)).toBe(true);
  });

  it("asks for the read each card makes: the user's own follow-ups, and the producer's notes", () => {
    expect(panel('follow-ups').requires).toEqual(['reminders:read:own']);
    expect(panel('notes').requires).toEqual(['notes:read']);
  });

  it('loads each panel as its card', async () => {
    expect(await panel('follow-ups').component()).toBe(FollowUpsPanelComponent);
    expect(await panel('notes').component()).toBe(NotesPanelComponent);
  });
});
