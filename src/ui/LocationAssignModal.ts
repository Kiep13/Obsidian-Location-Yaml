import { Modal, type App } from 'obsidian';
import type { LocationDefinition, LocationPromptContext, LocationPromptResult } from '../types';
import {
  dedupeLocationsByKey,
  normalizeLocationKey,
  normalizeLocationLabel,
} from '../utils/locationNormalization';

type ResolveSelection = (result: LocationPromptResult | null) => void;
const MAX_SUGGESTIONS = 5;

function buildSuggestions(context: LocationPromptContext): LocationDefinition[] {
  return dedupeLocationsByKey([...context.recentLocations, ...context.knownLocations]);
}

function getLocationScore(
  location: LocationDefinition,
  rawQuery: string,
  recentLocationIds: Set<string>,
  recentLocationRanks: Map<string, number>,
): number {
  const normalizedQuery = normalizeLocationKey(rawQuery);
  const normalizedLabel = normalizeLocationKey(location.label);

  if (!normalizedQuery) {
    if (recentLocationIds.has(location.id)) {
      return 10_000 - (recentLocationRanks.get(location.id) ?? 0);
    }

    return 0;
  }

  const queryIndex = normalizedLabel.indexOf(normalizedQuery);
  if (queryIndex < 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 1_000 - queryIndex * 10 - normalizedLabel.length;
  if (normalizedLabel === normalizedQuery) {
    score += 5_000;
  }
  if (recentLocationIds.has(location.id)) {
    score += 1_000;
  }

  return score;
}

export class LocationAssignModal extends Modal {
  private readonly resolveSelection: ResolveSelection;
  private readonly allSuggestions: LocationDefinition[];
  private readonly recentLocationIds: Set<string>;
  private readonly recentLocationRanks: Map<string, number>;
  private inputEl!: HTMLInputElement;
  private submitButtonEl!: HTMLButtonElement;
  private suggestionsEl!: HTMLElement;
  private filteredSuggestions: LocationDefinition[] = [];
  private settled = false;

  constructor(
    app: App,
    private readonly context: LocationPromptContext,
    resolveSelection: ResolveSelection,
  ) {
    super(app);
    this.resolveSelection = resolveSelection;
    this.allSuggestions = buildSuggestions(context);
    this.recentLocationIds = new Set(context.recentLocations.map((location) => location.id));
    this.recentLocationRanks = new Map(
      context.recentLocations.map((location, index) => [location.id, index]),
    );
  }

  public override onOpen(): void {
    this.contentEl.empty();
    this.titleEl.setText('Place where you create this note');
    this.modalEl.addClass('location-modal-shell');
    this.contentEl.addClass('location-modal');
    this.applyModalLayout();

    this.inputEl = this.contentEl.createEl('input', {
      attr: {
        type: 'text',
        placeholder: 'Search or enter a location',
        'aria-label': 'Location',
        autocomplete: 'off',
      },
    }) as unknown as HTMLInputElement;
    this.inputEl.value = this.context.defaultLocation?.label ?? '';
    Object.assign(this.inputEl.style, {
      display: 'block',
      width: '100%',
      height: '2.85rem',
      boxSizing: 'border-box',
      fontSize: 'var(--font-ui-medium)',
      borderRadius: '0.5rem',
    });

    this.suggestionsEl = this.contentEl.createDiv({
      cls: 'location-modal-suggestions',
    }) as unknown as HTMLElement;
    this.suggestionsEl.hidden = true;
    this.suggestionsEl.setAttribute('aria-hidden', 'true');
    this.suggestionsEl.setAttribute('role', 'listbox');

    const actionsEl = this.contentEl.createDiv({ cls: 'location-modal-actions' });
    Object.assign(actionsEl.style, {
      display: 'flex',
      justifyContent: 'center',
      width: '100%',
    });
    this.submitButtonEl = actionsEl.createEl('button', {
        text: 'Submit',
        cls: 'mod-cta',
        attr: { type: 'button', 'data-role': 'submit' },
      }) as unknown as HTMLButtonElement;
    Object.assign(this.submitButtonEl.style, {
      minWidth: '5.5rem',
      height: '2.6rem',
      fontSize: 'var(--font-ui-medium)',
      fontWeight: '600',
    });

    this.submitButtonEl.addEventListener('click', () => {
      this.chooseLocation(this.inputEl.value);
    });

    this.inputEl.addEventListener('input', () => {
      this.renderSuggestions(this.inputEl.value, false);
    });

    this.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        if (this.filteredSuggestions.length > 0) {
          this.focusSuggestion(0);
        } else {
          this.submitButtonEl.focus();
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.focusSuggestion(0);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        this.chooseLocation(this.inputEl.value);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.renderSuggestions(this.inputEl.value, true);
    this.inputEl.focus();
  }

  public override onClose(): void {
    if (!this.settled) {
      this.resolveSelection(null);
      this.settled = true;
    }
  }

  private applyModalLayout(): void {
    Object.assign(this.modalEl.style, {
      width: 'min(46rem, calc(100vw - 2rem))',
      borderRadius: '1.5rem',
      padding: '1.25rem 1.4rem 1.35rem',
    });
    Object.assign(this.titleEl.style, {
      fontSize: '1.55rem',
      fontWeight: '700',
      lineHeight: '1.2',
      margin: '0 2rem 1rem 0',
    });
    Object.assign(this.contentEl.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      padding: '0',
      width: '100%',
    });
  }

  private renderSuggestions(rawQuery: string, preferExactMatch: boolean): void {
    const normalizedQuery = normalizeLocationLabel(rawQuery);
    this.filteredSuggestions = [...this.allSuggestions]
      .map((location) => ({
        location,
        score: getLocationScore(location, normalizedQuery, this.recentLocationIds, this.recentLocationRanks),
      }))
      .filter((entry) => entry.score !== Number.NEGATIVE_INFINITY)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.location.label.localeCompare(right.location.label);
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((entry) => entry.location);

    this.suggestionsEl.empty();
    this.suggestionsEl.hidden = this.filteredSuggestions.length === 0;
    this.suggestionsEl.setAttribute('aria-hidden', this.filteredSuggestions.length === 0 ? 'true' : 'false');
    if (this.filteredSuggestions.length === 0) {
      return;
    }

    for (const [index, location] of this.filteredSuggestions.entries()) {
      const suggestionEl = this.suggestionsEl.createEl('button', {
        text: location.label,
        cls: 'location-modal-suggestion',
        attr: {
          type: 'button',
          'data-shortcut': String(index + 1),
          'aria-keyshortcuts': String(index + 1),
          tabindex: index === 0 ? '0' : '-1',
        },
      }) as unknown as HTMLButtonElement;
      suggestionEl.setAttribute('role', 'option');
      suggestionEl.setAttribute(
        'aria-selected',
        preferExactMatch && normalizeLocationKey(location.label) === normalizeLocationKey(normalizedQuery) ? 'true' : 'false',
      );
      suggestionEl.addEventListener('mousedown', (event: MouseEvent) => {
        event.preventDefault();
        this.chooseLocation(location.label);
      });
      suggestionEl.addEventListener('click', () => {
        this.chooseLocation(location.label);
      });
      suggestionEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          this.submitButtonEl.focus();
          return;
        }

        const shortcutIndex = this.getShortcutIndex(event);
        if (shortcutIndex !== null) {
          const shortcutLocation = this.filteredSuggestions[shortcutIndex];
          if (shortcutLocation) {
            event.preventDefault();
            this.chooseLocation(shortcutLocation.label);
          }
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.focusSuggestion(index + 1);
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (index === 0) {
            this.inputEl.focus();
            return;
          }
          this.focusSuggestion(index - 1);
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          this.chooseLocation(location.label);
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          this.close();
        }
      });
    }
  }

  private focusSuggestion(index: number): void {
    if (this.filteredSuggestions.length === 0) {
      return;
    }

    const nextIndex = Math.min(Math.max(index, 0), this.filteredSuggestions.length - 1);
    for (let childIndex = 0; childIndex < this.suggestionsEl.children.length; childIndex += 1) {
      const suggestionEl = this.suggestionsEl.children[childIndex] as HTMLButtonElement;
      suggestionEl.tabIndex = childIndex === nextIndex ? 0 : -1;
    }

    const suggestionEl = this.suggestionsEl.children[nextIndex] as HTMLButtonElement | undefined;
    if (suggestionEl) {
      suggestionEl.focus();
    }
  }

  private getShortcutIndex(event: KeyboardEvent): number | null {
    if (event.ctrlKey || event.metaKey || event.altKey || !/^[1-5]$/.test(event.key)) {
      return null;
    }

    return Number(event.key) - 1;
  }

  private chooseLocation(label: string): void {
    const normalizedLabel = normalizeLocationLabel(label);
    if (!normalizedLabel) {
      this.resolveSelection(null);
      this.settled = true;
      this.close();
      return;
    }

    this.settled = true;
    this.resolveSelection({ label: normalizedLabel });
    this.close();
  }
}

export function promptForLocation(
  app: App,
  context: LocationPromptContext,
): Promise<LocationPromptResult | null> {
  return new Promise((resolveSelection) => {
    new LocationAssignModal(app, context, resolveSelection).open();
  });
}
