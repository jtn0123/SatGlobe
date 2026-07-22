import { PluginRegistry } from '@app/engine/core/plugin-registry';
import type { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';

describe('PluginRegistry.getPluginById', () => {
  afterEach(() => PluginRegistry.unregisterAllPlugins());

  it('returns the plugin registered with the matching stable id', () => {
    const plugin = { id: 'ExamplePlugin' } as KeepTrackPlugin;

    PluginRegistry.addPlugin(plugin);

    expect(PluginRegistry.getPluginById('ExamplePlugin')).toBe(plugin);
    expect(PluginRegistry.getPluginById('MissingPlugin')).toBeNull();
  });
});
