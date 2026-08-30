import { Modal, type App } from 'obsidian';
import type { LocationUsageStatistic } from '../types';

const TOP_LOCATION_LIMIT = 8;
const OTHER_SEGMENT_KEY = '__other_locations__';
const DONUT_COLORS = [
  'hsl(210, 70%, 55%)',
  'hsl(150, 55%, 44%)',
  'hsl(32, 82%, 54%)',
  'hsl(280, 58%, 58%)',
  'hsl(348, 68%, 56%)',
  'hsl(188, 62%, 45%)',
  'hsl(72, 48%, 45%)',
  'hsl(18, 72%, 52%)',
  'var(--text-muted)',
];

interface ChartSegment {
  key: string;
  label: string;
  count: number;
  color: string;
}

interface StatisticsElement {
  disabled: boolean;
  createDiv: (options?: unknown) => StatisticsElement;
  createEl: (tagName: string, options?: unknown) => StatisticsElement;
  createSpan: (options?: unknown) => StatisticsElement;
  createSvg: (tagName: string, options?: unknown) => StatisticsElement;
  addClass: (...classes: string[]) => unknown;
  toggleClass: (className: string, state?: boolean) => unknown;
  empty: () => unknown;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (eventName: string, callback: (event: any) => void) => void;
}

function formatPercentage(count: number, total: number): string {
  const percentage = (count / total) * 100;
  return `${Number(percentage.toFixed(1))}%`;
}

function formatAssignmentUnit(total: number): string {
  return total === 1 ? 'location assignment' : 'location assignments';
}

function pointOnCircle(angle: number): { horizontalCoordinate: number; verticalCoordinate: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    horizontalCoordinate: 80 + 52 * Math.cos(radians),
    verticalCoordinate: 80 + 52 * Math.sin(radians),
  };
}

function createArcPath(startAngle: number, endAngle: number): string {
  const start = pointOnCircle(startAngle);
  const end = pointOnCircle(endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.horizontalCoordinate} ${start.verticalCoordinate} A 52 52 0 ${largeArcFlag} 1 ${end.horizontalCoordinate} ${end.verticalCoordinate}`;
}

export class LocationStatisticsModal extends Modal {
  private selectedSegmentKey: string | null = null;

  constructor(
    app: App,
    private readonly statistics: LocationUsageStatistic[],
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.modalEl.addClass('location-statistics-modal-shell');
    this.contentEl.addClass('location-statistics-modal');
    this.titleEl.setText('Location statistics');
    this.render();
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    if (this.statistics.length === 0) {
      this.contentEl.createEl('p', {
        text: 'No notes with a location yet.',
        cls: 'location-statistics-empty',
      });
      return;
    }

    const total = this.statistics.reduce((sum, entry) => sum + entry.count, 0);
    const segments = this.getChartSegments();
    const chartSection = this.contentEl.createDiv({ cls: 'location-statistics-chart-section' }) as unknown as StatisticsElement;
    this.renderChart(chartSection, segments, total);
  }

  private getChartSegments(): ChartSegment[] {
    const topLocations = this.statistics.slice(0, TOP_LOCATION_LIMIT);
    const otherLocations = this.statistics.slice(TOP_LOCATION_LIMIT);
    const segments = topLocations.map((location, index) => ({
      key: location.locationId,
      label: location.label,
      count: location.count,
      color: DONUT_COLORS[index],
    }));

    if (otherLocations.length > 0) {
      segments.push({
        key: OTHER_SEGMENT_KEY,
        label: 'Other',
        count: otherLocations.reduce((sum, location) => sum + location.count, 0),
        color: DONUT_COLORS[DONUT_COLORS.length - 1],
      });
    }

    return segments;
  }

  private renderChart(containerEl: StatisticsElement, segments: ChartSegment[], total: number): void {
    const chartWrapEl = containerEl.createDiv({ cls: 'location-statistics-donut-wrap' });
    const svgEl = chartWrapEl.createSvg('svg', {
      cls: 'location-statistics-donut',
      attr: {
        viewBox: '0 0 160 160',
        role: 'img',
        'aria-label': `${total} ${formatAssignmentUnit(total)}`,
      },
    });
    let startAngle = 0;

    for (const segment of segments) {
      const endAngle = startAngle + (segment.count / total) * 360;
      const pathEl = svgEl.createSvg(segments.length === 1 ? 'circle' : 'path');
      pathEl.addClass('location-statistics-donut-segment');
      pathEl.toggleClass('is-selected', this.selectedSegmentKey === segment.key);
      pathEl.toggleClass(
        'is-dimmed',
        this.selectedSegmentKey !== null && this.selectedSegmentKey !== segment.key,
      );
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('stroke', segment.color);
      pathEl.setAttribute('stroke-width', '24');
      pathEl.setAttribute('tabindex', '0');
      pathEl.setAttribute('role', 'button');
      pathEl.setAttribute('pointer-events', 'stroke');
      pathEl.setAttribute('data-segment-key', segment.key);
      pathEl.setAttribute('aria-label', `${segment.label}: ${segment.count} notes, ${formatPercentage(segment.count, total)}`);
      pathEl.setAttribute('aria-pressed', String(this.selectedSegmentKey === segment.key));

      if (segments.length === 1) {
        pathEl.setAttribute('cx', '80');
        pathEl.setAttribute('cy', '80');
        pathEl.setAttribute('r', '52');
      } else {
        pathEl.setAttribute('d', createArcPath(startAngle, endAngle));
      }

      pathEl.addEventListener('click', () => this.selectSegment(segment.key));
      pathEl.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.selectSegment(segment.key);
        }
      });
      startAngle = endAngle;
    }

    const centerEl = chartWrapEl.createDiv({ cls: 'location-statistics-donut-center' });
    centerEl.createEl('strong', { text: String(total) });
    centerEl.createSpan({ text: formatAssignmentUnit(total) });

    const legendEl = containerEl.createEl('ul', { cls: 'location-statistics-legend' });
    for (const segment of segments) {
      const legendItemEl = legendEl.createEl('li', {
        cls: 'location-statistics-legend-item',
        attr: this.selectedSegmentKey === segment.key ? { style: 'font-weight: 700;' } : {},
      });
      legendItemEl.toggleClass('is-selected', this.selectedSegmentKey === segment.key);
      legendItemEl.createSpan({
        cls: 'location-statistics-swatch',
        attr: { style: `--location-statistics-color: ${segment.color}` },
      });
      legendItemEl.createSpan({
        text: segment.label,
        cls: 'location-statistics-legend-label',
        attr: { style: 'color: var(--text-normal);' },
      });
      legendItemEl.createSpan({
        text: `\u00a0${segment.count} (${formatPercentage(segment.count, total)})`,
        cls: 'location-statistics-legend-count',
        attr: {
          style: 'display: inline-block; margin-left: 0.6rem; color: var(--text-accent);',
        },
      });
    }

    if (this.selectedSegmentKey !== null) {
      const resetButtonEl = containerEl.createEl('button', {
        text: 'All locations',
        cls: 'location-statistics-reset',
        attr: { type: 'button' },
      });
      resetButtonEl.addEventListener('click', () => this.selectSegment(null));
    }
  }

  private selectSegment(segmentKey: string | null): void {
    this.selectedSegmentKey = segmentKey;
    this.render();
  }
}
