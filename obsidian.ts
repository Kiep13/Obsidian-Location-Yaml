type EventCallback = (...values: unknown[]) => void;

class MockElement {
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public textContent = '';
  public value = '';
  public checked = false;
  public disabled = false;
  public dataset: Record<string, string> = {};
  public style: Record<string, string> = {};
  public classList = new Set<string>();
  public onclick: ((event: MouseEvent) => void) | null = null;

  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(public readonly tagName: string = 'div') {}

  public createDiv(options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): MockElement {
    return this.createEl('div', options);
  }

  public createSpan(options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): MockElement {
    return this.createEl('span', options);
  }

  public createEl(
    tagName: string,
    options: { cls?: string; text?: string; title?: string; attr?: Record<string, string> } = {},
  ): MockElement {
    const childElement = new MockElement(tagName);
    if (options.cls) {
      childElement.addClass(...options.cls.split(' '));
    }
    if (options.text) {
      childElement.textContent = options.text;
    }
    if (options.title) {
      childElement.setAttribute('title', options.title);
    }
    if (options.attr) {
      for (const [attributeName, attributeValue] of Object.entries(options.attr)) {
        childElement.setAttribute(attributeName, attributeValue);
      }
    }

    childElement.parentElement = this;
    this.children.push(childElement);
    return childElement;
  }

  public createSvg(
    tagName: string,
    options: { cls?: string; attr?: Record<string, string> } = {},
  ): MockElement {
    return this.createEl(tagName, options);
  }

  public appendChild(childElement: MockElement): MockElement {
    childElement.parentElement = this;
    this.children.push(childElement);
    return childElement;
  }

  public prepend(childElement: MockElement): MockElement {
    childElement.parentElement = this;
    this.children.unshift(childElement);
    return childElement;
  }

  public appendText(text: string): this {
    this.textContent += text;
    return this;
  }

  public setText(text: string): this {
    this.textContent = text;
    return this;
  }

  public addClass(...classes: string[]): this {
    for (const className of classes) {
      if (className) {
        this.classList.add(className);
      }
    }
    return this;
  }

  public removeClass(...classes: string[]): this {
    for (const className of classes) {
      this.classList.delete(className);
    }
    return this;
  }

  public toggleClass(className: string, state?: boolean): this {
    if (state === undefined) {
      if (this.classList.has(className)) {
        this.classList.delete(className);
      } else {
        this.classList.add(className);
      }
      return this;
    }

    if (state) {
      this.classList.add(className);
    } else {
      this.classList.delete(className);
    }
    return this;
  }

  public hasClass(className: string): boolean {
    return this.classList.has(className);
  }

  public empty(): this {
    this.children = [];
    this.textContent = '';
    return this;
  }

  public setAttribute(name: string, value: string): void {
    if (name === 'value') {
      this.value = value;
      return;
    }
    if (name === 'checked') {
      this.checked = value === 'true' || value === 'checked';
      return;
    }
    if (name.startsWith('data-')) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (unusedMatch, character: string) => {
          void unusedMatch;
          return character.toUpperCase();
        });
      this.dataset[key] = value;
      return;
    }
    this.style[name] = value;
  }

  public addEventListener(eventName: string, callback: (event: unknown) => void): void {
    const callbacks = this.listeners.get(eventName) ?? [];
    callbacks.push(callback);
    this.listeners.set(eventName, callbacks);
  }

  public dispatchEvent(event: { type: string; preventDefault?: () => void; key?: string; [key: string]: unknown }): boolean {
    const callbacks = this.listeners.get(event.type) ?? [];
    for (const callback of callbacks) {
      callback(event);
    }
    const handler = (this as Record<string, unknown>)[`on${event.type}`];
    if (typeof handler === 'function') {
      (handler as (value: typeof event) => void)(event);
    }
    return true;
  }

  public click(): void {
    this.dispatchEvent({
      type: 'click',
      preventDefault: () => undefined,
    });
  }

  public focus(): void {}
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = frontmatterMatch[1].split('\n');
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterLines) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const rawValue = match[2].trim();
    frontmatter[key] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }

  return {
    frontmatter,
    body: content.slice(frontmatterMatch[0].length),
  };
}

function serializeFrontmatter(frontmatter: Record<string, string>, body: string): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    const escapedValue = value.includes(':') || value.includes('#') || value.includes('[[')
      ? JSON.stringify(value)
      : value;
    lines.push(`${key}: ${escapedValue}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}${body}`;
}

class EventEmitter {
  private readonly listeners = new Map<string, Set<EventCallback>>();

  public on(eventName: string, callback: EventCallback): () => void {
    const callbacks = this.listeners.get(eventName) ?? new Set<EventCallback>();
    callbacks.add(callback);
    this.listeners.set(eventName, callbacks);
    return () => callbacks.delete(callback);
  }

  public emit(eventName: string, ...values: unknown[]): void {
    const callbacks = this.listeners.get(eventName);
    if (!callbacks) {
      return;
    }

    for (const callback of callbacks) {
      callback(...values);
    }
  }
}

export class TFile {
  public basename: string;

  constructor(
    public path = '',
    public extension = 'md',
  ) {
    this.basename = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path;
  }
}

export class TFolder {
  constructor(public children: Array<TFile | TFolder> = []) {}
}

export class Vault {
  private readonly files = new Map<string, string>();
  private readonly emitter = new EventEmitter();

  public on(eventName: 'create', callback: (file: TFile) => void): () => void;
  public on(eventName: 'modify', callback: (file: TFile) => void): () => void;
  public on(eventName: 'rename', callback: (file: TFile, oldPath: string) => void): () => void;
  public on(eventName: 'delete', callback: (file: TFile) => void): () => void;
  public on(eventName: string, callback: (...values: any[]) => void): () => void {
    return this.emitter.on(eventName, callback);
  }

  public async create(path: string, content: string): Promise<TFile> {
    const file = new TFile(path, path.endsWith('.md') ? 'md' : path.split('.').pop() ?? '');
    this.files.set(path, content);
    this.emitter.emit('create', file);
    return file;
  }

  public async read(file: TFile): Promise<string> {
    return this.files.get(file.path) ?? '';
  }

  public async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
    this.emitter.emit('modify', file);
  }

  public getMarkdownFiles(): TFile[] {
    return [...this.files.keys()]
      .filter((path) => path.endsWith('.md'))
      .sort()
      .map((path) => new TFile(path, 'md'));
  }

  public getFileByPath(path: string): TFile | null {
    return this.files.has(path) ? new TFile(path, path.endsWith('.md') ? 'md' : path.split('.').pop() ?? '') : null;
  }

  public getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.getFileByPath(path);
  }

  public getFileContent(path: string): string {
    return this.files.get(path) ?? '';
  }

  public async createFolder(path: string): Promise<void> {
    void path;
  }

  public rename(file: TFile, newPath: string): void {
    const oldPath = file.path;
    const content = this.files.get(file.path);
    if (content === undefined) {
      return;
    }
    this.files.delete(file.path);
    file.path = newPath;
    file.basename = newPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? newPath;
    this.files.set(newPath, content);
    this.emitter.emit('rename', file, oldPath);
  }
}

export class Workspace {
  private readonly emitter = new EventEmitter();
  private activeFile: TFile | null = null;
  private layoutReady = false;

  public on(eventName: 'file-open', callback: (file: TFile | null) => void): () => void;
  public on(eventName: string, callback: (...values: any[]) => void): () => void {
    return this.emitter.on(eventName, callback);
  }

  public onLayoutReady(callback: () => void): void {
    if (this.layoutReady) {
      callback();
      return;
    }

    this.emitter.on('layout-ready', callback);
  }

  public openFile(file: TFile | null): void {
    this.activeFile = file;
    this.emitter.emit('file-open', file);
  }

  public getActiveFile(): TFile | null {
    return this.activeFile;
  }

  public setActiveFile(file: TFile | null): void {
    this.activeFile = file;
  }

  public triggerLayoutReady(): void {
    if (this.layoutReady) {
      return;
    }

    this.layoutReady = true;
    this.emitter.emit('layout-ready');
  }
}

export class MetadataCache {
  private readonly emitter = new EventEmitter();

  constructor(private readonly vault: Vault) {}

  public on(eventName: 'resolved', callback: () => void): () => void;
  public on(eventName: 'changed', callback: (file: TFile, ...values: unknown[]) => void): () => void;
  public on(eventName: string, callback: (...values: any[]) => void): () => void {
    return this.emitter.on(eventName, callback);
  }

  public emit(eventName: 'resolved' | 'changed', ...values: unknown[]): void {
    this.emitter.emit(eventName, ...values);
  }

  public getFileCache(file: TFile): { frontmatter?: Record<string, string> } | null {
    const content = this.vault.getFileContent(file.path);
    const { frontmatter } = parseFrontmatter(content);
    return { frontmatter };
  }
}

export class FileManager {
  constructor(private readonly vault: Vault) {}

  public async processFrontMatter(
    file: TFile,
    callback: (frontmatter: Record<string, string>) => void,
  ): Promise<void> {
    const content = await this.vault.read(file);
    const { frontmatter, body } = parseFrontmatter(content);
    callback(frontmatter);
    await this.vault.modify(file, serializeFrontmatter(frontmatter, body));
  }
}

export class App {
  public readonly vault = new Vault();
  public readonly workspace = new Workspace();
  public readonly metadataCache = new MetadataCache(this.vault);
  public readonly fileManager = new FileManager(this.vault);
}

export class Notice {
  public static readonly history: Notice[] = [];

  constructor(public readonly message: string, public readonly timeout?: number) {
    Notice.history.push(this);
  }
}

class AbstractMockControl<Value> {
  private changeCallback: ((value: Value) => unknown) | null = null;

  public onChange(callback: (value: Value) => unknown): this {
    this.changeCallback = callback;
    return this;
  }

  protected emitChange(value: Value): void {
    this.changeCallback?.(value);
  }
}

export class TextComponent extends AbstractMockControl<string> {
  public readonly inputEl: MockElement;

  constructor(containerEl: MockElement) {
    super();
    this.inputEl = containerEl.createEl('input', { attr: { type: 'text' } });
    this.inputEl.addEventListener('change', () => this.emitChange(this.inputEl.value));
    this.inputEl.addEventListener('input', () => this.emitChange(this.inputEl.value));
  }

  public setPlaceholder(placeholder: string): this {
    this.inputEl.setAttribute('placeholder', placeholder);
    return this;
  }

  public setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
}

export class TextAreaComponent extends AbstractMockControl<string> {
  public readonly inputEl: MockElement & { rows?: number };

  constructor(containerEl: MockElement) {
    super();
    this.inputEl = containerEl.createEl('textarea') as MockElement & { rows?: number };
    this.inputEl.addEventListener('change', () => this.emitChange(this.inputEl.value));
    this.inputEl.addEventListener('input', () => this.emitChange(this.inputEl.value));
  }

  public setPlaceholder(placeholder: string): this {
    this.inputEl.setAttribute('placeholder', placeholder);
    return this;
  }

  public setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
}

export class ToggleComponent extends AbstractMockControl<boolean> {
  public readonly toggleEl: MockElement;

  constructor(containerEl: MockElement) {
    super();
    this.toggleEl = containerEl.createEl('input', { attr: { type: 'checkbox' } });
    this.toggleEl.addEventListener('change', () => this.emitChange(this.toggleEl.checked));
  }

  public setValue(value: boolean): this {
    this.toggleEl.checked = value;
    return this;
  }
}

export class Setting {
  public readonly settingEl: MockElement;
  public readonly infoEl: MockElement;
  public readonly nameEl: MockElement;
  public readonly descEl: MockElement;
  public readonly controlEl: MockElement;

  constructor(containerEl: MockElement) {
    this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
    this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
    this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }

  public setName(name: string): this {
    this.nameEl.setText(name);
    return this;
  }

  public setDesc(desc: string): this {
    this.descEl.setText(desc);
    return this;
  }

  public addText(callback: (component: TextComponent) => unknown): this {
    callback(new TextComponent(this.controlEl));
    return this;
  }

  public addTextArea(callback: (component: TextAreaComponent) => unknown): this {
    callback(new TextAreaComponent(this.controlEl));
    return this;
  }

  public addToggle(callback: (component: ToggleComponent) => unknown): this {
    callback(new ToggleComponent(this.controlEl));
    return this;
  }
}

export class Modal {
  public readonly containerEl = new MockElement('div');
  public readonly modalEl = new MockElement('div');
  public readonly contentEl = new MockElement('div');
  public readonly titleEl = new MockElement('div');

  constructor(public readonly app: App) {
    this.containerEl.appendChild(this.modalEl);
    this.modalEl.appendChild(this.titleEl);
    this.modalEl.appendChild(this.contentEl);
  }

  public open(): void {
    this.onOpen();
  }

  public close(): void {
    this.onClose();
  }

  public onOpen(): void {}

  public onClose(): void {}
}

export class PluginSettingTab {
  public readonly containerEl = new MockElement('div');

  constructor(
    public readonly app: App,
    public readonly plugin: Plugin,
  ) {
    void plugin.manifest.name;
  }

  public display(): void {}
}

export class Plugin {
  public readonly app = new App();
  public readonly manifest = { name: 'Obsidian Location' };
  public readonly settingTabs: PluginSettingTab[] = [];

  private data: unknown = null;
  private readonly registeredEvents: Array<() => void> = [];
  private readonly commands = new Map<string, { id: string; name: string; callback?: () => void | Promise<void> }>();

  public async loadData(): Promise<unknown> {
    return this.data;
  }

  public async saveData(data: unknown): Promise<void> {
    this.data = data;
  }

  public addCommand(command: { id: string; name: string; callback?: () => void | Promise<void> }): void {
    this.commands.set(command.id, command);
  }

  public async executeCommand(commandId: string): Promise<void> {
    await this.commands.get(commandId)?.callback?.();
  }

  public addRibbonIcon(icon: string, title: string, callback: () => void): MockElement {
    void icon;
    void title;
    void callback;
    return new MockElement('button');
  }

  public addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
  }

  public registerEvent(disposer: () => void): void {
    this.registeredEvents.push(disposer);
  }

  public onunload(): void {
    for (const disposer of this.registeredEvents) {
      disposer();
    }
  }
}

export function setIcon(element: MockElement, icon: string): void {
  void element;
  void icon;
}

export async function requestUrl(): Promise<{
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
}> {
  return {
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json: null,
    text: '',
  };
}

export const Platform = {
  isMacOS: false,
  isWin: false,
  isLinux: true,
};

export { MockElement };
