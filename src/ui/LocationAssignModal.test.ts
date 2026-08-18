import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { LocationAssignModal } from './LocationAssignModal';
import type { LocationPromptContext, LocationPromptResult } from '../types';

type ResolveSelection = (result: LocationPromptResult | null) => void;

describe('LocationAssignModal', () => {
  let app: App;
  let context: LocationPromptContext;
  let resolveSelection: ResolveSelection;
  let modal: LocationAssignModal;

  beforeEach(() => {
    app = new App();
    context = {
      filePath: 'Notes/new-note.md',
      defaultLocation: { id: 'location-office', label: 'Office' },
      pinnedLocations: [{ id: 'location-cafe', label: 'Cafe' }],
      recentLocations: [
        { id: 'location-cafe', label: 'Cafe' },
        { id: 'location-home', label: 'Home' },
      ],
      knownLocations: [
        { id: 'location-office', label: 'Office' },
        { id: 'location-home', label: 'Home' },
        { id: 'location-cafe', label: 'Cafe' },
        { id: 'location-gym', label: 'Gym' },
      ],
    };
    resolveSelection = vi.fn<ResolveSelection>();
    modal = new LocationAssignModal(app, context, resolveSelection);
  });

  function findFirstByTag(element: any, tagName: string): any {
    if (element?.tagName === tagName) {
      return element;
    }

    for (const child of element?.children ?? []) {
      const foundChild = findFirstByTag(child, tagName);
      if (foundChild) {
        return foundChild;
      }
    }

    return null;
  }

  function findFirstByClass(element: any, className: string): any {
    if (element?.classList?.has(className)) {
      return element;
    }

    for (const child of element?.children ?? []) {
      const foundChild = findFirstByClass(child, className);
      if (foundChild) {
        return foundChild;
      }
    }

    return null;
  }

  function findSubmitButton(element: any): any {
    if (element?.tagName === 'button' && element?.dataset?.role === 'submit') {
      return element;
    }

    for (const child of element?.children ?? []) {
      const foundChild = findSubmitButton(child);
      if (foundChild) {
        return foundChild;
      }
    }

    return null;
  }

  it('prefills the input with the default location and exposes the exact match', () => {
    modal.onOpen();

    expect(modal.titleEl.textContent).toBe('Place where you create this nore');

    const input = findFirstByTag(modal.contentEl, 'input');
    expect(input?.value).toBe('Office');

    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    expect(suggestions?.children.map((child: any) => child.textContent)).toEqual(['Office']);
  });

  it('shows recent locations when the field is empty', () => {
    modal.onOpen();

    const input = findFirstByTag(modal.contentEl, 'input');
    input.value = '';
    input.dispatchEvent({ type: 'input' });

    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    expect(suggestions?.children.map((child: any) => child.textContent)).toEqual([
      'Cafe',
      'Home',
      'Gym',
      'Office',
    ]);
  });

  it('uses arrow keys and enter to choose a suggestion', () => {
    modal.onOpen();

    const input = findFirstByTag(modal.contentEl, 'input');
    input.value = 'ca';
    input.dispatchEvent({ type: 'input' });
    input.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault: () => undefined,
    });

    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    suggestions.children[0].dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault: () => undefined,
    });

    expect(resolveSelection).toHaveBeenCalledWith({ label: 'Cafe' });
  });

  it('creates a new user-defined location from typed text', () => {
    modal.onOpen();

    const input = findFirstByTag(modal.contentEl, 'input');
    input.value = 'Gym';
    input.dispatchEvent({ type: 'input' });
    input.dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault: () => undefined,
    });

    expect(resolveSelection).toHaveBeenCalledWith({ label: 'Gym' });
  });

  it('submits the typed location with the button', () => {
    modal.onOpen();

    const input = findFirstByTag(modal.contentEl, 'input');
    const button = findSubmitButton(modal.contentEl);
    input.value = 'Cafe Downtown';
    button.dispatchEvent({ type: 'click' });

    expect(resolveSelection).toHaveBeenCalledWith({ label: 'Cafe Downtown' });
  });

  it('limits suggestions to five items', () => {
    context.knownLocations.push(
      { id: 'location-home', label: 'Home' },
      { id: 'location-library', label: 'Library' },
      { id: 'location-park', label: 'Park' },
    );
    modal = new LocationAssignModal(app, context, resolveSelection);
    modal.onOpen();

    const input = findFirstByTag(modal.contentEl, 'input');
    input.value = '';
    input.dispatchEvent({ type: 'input' });

    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    expect(suggestions?.children).toHaveLength(5);
  });
});
