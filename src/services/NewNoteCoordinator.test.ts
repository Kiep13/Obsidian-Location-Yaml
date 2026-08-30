import { describe, expect, it } from 'vitest';
import { NewNoteCoordinator } from './NewNoteCoordinator';

describe('NewNoteCoordinator', () => {
  it('removes expired candidates instead of reviving them after a rename', () => {
    let now = 0;
    const coordinator = new NewNoteCoordinator(() => now, 10);
    coordinator.markReady();
    coordinator.markCreated('Notes/new.md');

    now = 11;
    coordinator.clearExpired();
    now = 0;
    coordinator.handleRename('Notes/new.md', 'Notes/renamed.md');

    expect(coordinator.shouldPrompt('Notes/renamed.md')).toBe(false);
  });

  it('removes handled and skipped candidates immediately', () => {
    const coordinator = new NewNoteCoordinator(() => 0, 10);
    coordinator.markReady();

    coordinator.markCreated('Notes/handled.md');
    coordinator.markHandled('Notes/handled.md');
    coordinator.handleRename('Notes/handled.md', 'Notes/handled-renamed.md');

    coordinator.markCreated('Notes/skipped.md');
    coordinator.markSkipped('Notes/skipped.md');
    coordinator.handleRename('Notes/skipped.md', 'Notes/skipped-renamed.md');

    expect(coordinator.shouldPrompt('Notes/handled-renamed.md')).toBe(false);
    expect(coordinator.shouldPrompt('Notes/skipped-renamed.md')).toBe(false);
  });
});
