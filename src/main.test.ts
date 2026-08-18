import { describe, expect, it } from 'vitest';
import ObsidianLocationPlugin from './main';

describe('ObsidianLocationPlugin', () => {
  it('loads without throwing', async () => {
    const plugin = new ObsidianLocationPlugin();
    await expect(plugin.onload()).resolves.toBeUndefined();
  });
});
