import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { LocationStore } from '../services/LocationStore';

export class LocationSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly store: LocationStore,
  ) {
    super(app, plugin);
  }

  public override display(): void {
    const container = this.containerEl as any;
    container.empty();
    container.addClass('location-setting-tab');
    container.createEl('h2', { text: 'Obsidian Location' });

    const settings = this.store.getSettings();
    const labels = this.store.getSettingsLabels();
    let defaultLabel = labels.defaultLocation;
    let showPopupOnCreate = settings.showPopupOnCreate;
    let autoApplyDefaultWhenOnlyOneChoice = settings.autoApplyDefaultWhenOnlyOneChoice;

    const save = (): void => {
      void this.persist(defaultLabel, showPopupOnCreate, autoApplyDefaultWhenOnlyOneChoice);
    };

    new Setting(container)
      .setName('Default location')
      .setDesc('Used as the first suggestion for new notes.')
      .addText((text) => {
        text
          .setPlaceholder('Home, Office, Cafe')
          .setValue(defaultLabel)
          .onChange((value) => {
            defaultLabel = value;
            save();
          });
      });

    new Setting(container)
      .setName('Show location picker')
      .setDesc('Ask for a location whenever a Markdown note is created.')
      .addToggle((toggle) => {
        toggle.setValue(showPopupOnCreate).onChange((value) => {
          showPopupOnCreate = value;
          save();
        });
      });

    new Setting(container)
      .setName('Auto-apply single choice')
      .setDesc('Skip the picker when there is only one available location.')
      .addToggle((toggle) => {
        toggle.setValue(autoApplyDefaultWhenOnlyOneChoice).onChange((value) => {
          autoApplyDefaultWhenOnlyOneChoice = value;
          save();
        });
      });
  }

  private async persist(
    defaultLabel: string,
    showPopupOnCreate: boolean,
    autoApplyDefaultWhenOnlyOneChoice: boolean,
  ): Promise<void> {
    this.store.updateSettingsFromLabels(
      defaultLabel,
      showPopupOnCreate,
      autoApplyDefaultWhenOnlyOneChoice,
    );
    await this.store.save();
  }
}
