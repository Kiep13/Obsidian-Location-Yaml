declare global {
  interface HTMLElement {
    createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLElement;
    createEl<TagName extends keyof HTMLElementTagNameMap>(
      tagName: TagName,
      options?: { cls?: string; text?: string; title?: string; attr?: Record<string, string> },
    ): HTMLElementTagNameMap[TagName];
    setText(text: string): this;
    addClass(...classes: string[]): this;
    removeClass(...classes: string[]): this;
    toggleClass(className: string, state?: boolean): this;
    hasClass(className: string): boolean;
    empty(): this;
  }
}

export {};
