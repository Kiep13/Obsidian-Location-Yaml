import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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

  function dispatchKeydown(
    element: any,
    key: string,
    modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ): any {
    const event = {
      type: 'keydown',
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      ...modifiers,
    };
    element.dispatchEvent(event);
    return event;
  }

  function openWithFiveSuggestions(): any {
    context = {
      ...context,
      defaultLocation: null,
      knownLocations: [
        ...context.knownLocations,
        { id: 'location-airport', label: 'Airport' },
      ],
    };
    modal = new LocationAssignModal(app, context, resolveSelection);
    modal.onOpen();
    return findFirstByClass(modal.contentEl, 'location-modal-suggestions');
  }

  it('prefills the input with the default location and exposes the exact match', () => {
    modal.onOpen();

    expect(modal.titleEl.textContent).toBe('Place where you create this note');

    const input = findFirstByTag(modal.contentEl, 'input');
    expect(input?.value).toBe('Office');

    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    expect(suggestions?.hidden).toBe(false);
    expect(suggestions?.children.map((child: any) => child.textContent)).toEqual(['Office']);
  });

  it('updates visible suggestions from empty input to partial and exact matches', () => {
    context = {
      ...context,
      defaultLocation: null,
      recentLocations: [
        { id: 'location-cafe', label: 'Cafe' },
        { id: 'location-home', label: 'Home' },
      ],
      knownLocations: [
        { id: 'location-office', label: 'Office' },
        { id: 'location-home', label: 'Home' },
        { id: 'location-cafe', label: 'Cafe' },
        { id: 'location-gym', label: 'Gym' },
        { id: 'location-bratislava', label: 'Bratislava' },
      ],
    };
    modal = new LocationAssignModal(app, context, resolveSelection);
    modal.onOpen();

    const input = findFirstByTag(modal.contentEl, 'input');
    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    const renderedLabels = () => suggestions?.children.map((child: any) => child.textContent);

    input.value = '';
    input.dispatchEvent({ type: 'input' });
    expect(suggestions?.hidden).toBe(false);
    expect(renderedLabels()).toEqual(['Cafe', 'Home', 'Bratislava', 'Gym', 'Office']);

    input.value = 'Brat';
    input.dispatchEvent({ type: 'input' });
    expect(suggestions?.hidden).toBe(false);
    expect(renderedLabels()).toEqual(['Bratislava']);

    input.value = 'Bratislava';
    input.dispatchEvent({ type: 'input' });
    expect(suggestions?.hidden).toBe(false);
    expect(renderedLabels()).toEqual(['Bratislava']);
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

  it('exposes shortcut indices without changing suggestion text', () => {
    const suggestions = openWithFiveSuggestions();

    expect(suggestions.children.map((child: any) => child.textContent)).toEqual([
      'Cafe',
      'Home',
      'Airport',
      'Gym',
      'Office',
    ]);
    expect(suggestions.children.map((child: any) => child.dataset.shortcut)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('shows plain shortcut badges only within the focused suggestion block without reflow', () => {
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const badgeRule = /\.location-modal-suggestion::after\s*\{([\s\S]*?)\}/.exec(styles)?.[1] ?? '';
    const focusedBadgeRule = /\.location-modal-suggestions:focus-within \.location-modal-suggestion::after\s*\{([\s\S]*?)\}/.exec(styles)?.[1] ?? '';

    expect(badgeRule).toMatch(/position:\s*absolute/);
    expect(badgeRule).toMatch(/content:\s*attr\(data-shortcut\)/);
    expect(badgeRule).toMatch(/opacity:\s*0/);
    expect(badgeRule).toMatch(/visibility:\s*hidden/);
    expect(badgeRule).not.toMatch(/border\s*:/);
    expect(badgeRule).not.toMatch(/background\s*:/);
    expect(badgeRule).not.toMatch(/border-radius\s*:/);
    expect(badgeRule).not.toMatch(/(?:^|\n)\s*min-width\s*:/);
    expect(badgeRule).not.toMatch(/(?:^|\n)\s*height\s*:/);
    expect(focusedBadgeRule).toMatch(/opacity:\s*1/);
    expect(focusedBadgeRule).toMatch(/visibility:\s*visible/);
  });

  it('moves forward Tab from the input to the first visible suggestion', () => {
    const suggestions = openWithFiveSuggestions();
    const input = findFirstByTag(modal.contentEl, 'input');

    const event = dispatchKeydown(input, 'Tab');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(suggestions.children[0].focused).toBe(true);
    expect(suggestions.children[0].tabIndex).toBe(0);
    expect(suggestions.children[1].focused).toBe(false);
  });

  it('moves forward Tab from a focused suggestion to Submit', () => {
    const suggestions = openWithFiveSuggestions();
    const input = findFirstByTag(modal.contentEl, 'input');
    const submitButton = findSubmitButton(modal.contentEl);

    dispatchKeydown(input, 'Tab');
    const event = dispatchKeydown(suggestions.children[0], 'Tab');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(submitButton.focused).toBe(true);
  });

  it('moves forward Tab from the input to Submit when there are no results', () => {
    modal.onOpen();

    const input = findFirstByTag(modal.contentEl, 'input');
    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    const submitButton = findSubmitButton(modal.contentEl);
    input.value = 'Not a known location';
    input.dispatchEvent({ type: 'input' });

    const event = dispatchKeydown(input, 'Tab');

    expect(suggestions.hidden).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(submitButton.focused).toBe(true);
  });

  it('restores the suggestion focus path after a no-results refilter', () => {
    const suggestions = openWithFiveSuggestions();
    const input = findFirstByTag(modal.contentEl, 'input');
    const submitButton = findSubmitButton(modal.contentEl);

    input.value = 'Not a known location';
    input.dispatchEvent({ type: 'input' });
    expect(suggestions.hidden).toBe(true);
    dispatchKeydown(input, 'Tab');
    expect(submitButton.focused).toBe(true);

    input.value = 'Air';
    input.dispatchEvent({ type: 'input' });
    expect(suggestions.hidden).toBe(false);
    expect(suggestions.children.map((child: any) => child.textContent)).toEqual(['Airport']);
    expect(suggestions.children[0].tabIndex).toBe(0);

    dispatchKeydown(input, 'Tab');
    expect(suggestions.children[0].focused).toBe(true);
  });

  it('keeps suggestions arrow-focusable with a roving tabindex', () => {
    const suggestions = openWithFiveSuggestions();
    const input = findFirstByTag(modal.contentEl, 'input');

    dispatchKeydown(input, 'Tab');
    expect(suggestions.children.map((child: any) => child.tabIndex)).toEqual([0, -1, -1, -1, -1]);

    dispatchKeydown(suggestions.children[0], 'ArrowDown');
    expect(suggestions.children[1].focused).toBe(true);
    expect(suggestions.children.map((child: any) => child.tabIndex)).toEqual([-1, 0, -1, -1, -1]);

    dispatchKeydown(suggestions.children[1], 'ArrowDown');
    expect(suggestions.children[2].focused).toBe(true);
    expect(suggestions.children.map((child: any) => child.tabIndex)).toEqual([-1, -1, 0, -1, -1]);

    dispatchKeydown(suggestions.children[2], 'ArrowUp');
    expect(suggestions.children[1].focused).toBe(true);
    expect(suggestions.children.map((child: any) => child.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
  });

  it('selects the current first visible suggestion with shortcut 1', () => {
    const suggestions = openWithFiveSuggestions();
    suggestions.children[0].focus();

    const event = dispatchKeydown(suggestions.children[0], '1');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(resolveSelection).toHaveBeenCalledWith({ label: 'Cafe' });
  });

  it('selects the current fifth visible suggestion with shortcut 5', () => {
    const suggestions = openWithFiveSuggestions();
    suggestions.children[4].focus();

    const event = dispatchKeydown(suggestions.children[4], '5');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(resolveSelection).toHaveBeenCalledWith({ label: 'Office' });
  });

  it('ignores out-of-range and modified numeric shortcuts', () => {
    modal.onOpen();
    const suggestions = findFirstByClass(modal.contentEl, 'location-modal-suggestions');
    suggestions.children[0].focus();

    const outOfRangeEvent = dispatchKeydown(suggestions.children[0], '5');
    const ctrlEvent = dispatchKeydown(suggestions.children[0], '1', { ctrlKey: true });
    const metaEvent = dispatchKeydown(suggestions.children[0], '1', { metaKey: true });
    const altEvent = dispatchKeydown(suggestions.children[0], '1', { altKey: true });
    const shiftEvent = dispatchKeydown(suggestions.children[0], '1', { shiftKey: true });

    expect(outOfRangeEvent.preventDefault).not.toHaveBeenCalled();
    expect(ctrlEvent.preventDefault).not.toHaveBeenCalled();
    expect(metaEvent.preventDefault).not.toHaveBeenCalled();
    expect(altEvent.preventDefault).not.toHaveBeenCalled();
    expect(shiftEvent.preventDefault).not.toHaveBeenCalled();
    expect(resolveSelection).not.toHaveBeenCalled();
  });

  it('activates a suggestion once for a mouse press and click sequence', () => {
    const suggestions = openWithFiveSuggestions();
    const suggestion = suggestions.children[0];
    const mousedownEvent = { type: 'mousedown', preventDefault: vi.fn() };

    suggestion.dispatchEvent(mousedownEvent);
    suggestion.dispatchEvent({ type: 'click', preventDefault: vi.fn() });

    expect(mousedownEvent.preventDefault).toHaveBeenCalled();
    expect(resolveSelection).toHaveBeenCalledTimes(1);
    expect(resolveSelection).toHaveBeenCalledWith({ label: 'Cafe' });
  });

  it('does not intercept digits typed in the input', () => {
    modal.onOpen();
    const input = findFirstByTag(modal.contentEl, 'input');

    const event = dispatchKeydown(input, '1');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(resolveSelection).not.toHaveBeenCalled();
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
