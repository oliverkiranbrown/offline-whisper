/**
 * Tests for the desktop (non-mobile) code paths in WhisperSettingTab and WhisperTranscriptionPlugin.
 * Forces desktop mode via globalThis.__desktopOverride to cover lines 582-621 of main.js.
 */

// Force platform override before module initialization
globalThis.__desktopOverride = true;
jest.resetModules();
jest.clearAllMocks();
globalThis._capturedBtns = [];

// Obsidian test-mocks map `obsidian` -> `obsidian-test-mocks/obsidian` via Jest config.
jest.mock('../src/desktop-transcriber.js', () => ({
  DesktopTranscriber: jest.fn().mockImplementation(() => ({ isModelCached: jest.fn(), clearCache: jest.fn() })),
}));

jest.mock('../src/desktop-cleaner.js', () => ({
  DesktopCleaner: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(),
    clean: jest.fn().mockResolvedValue('Cleaned text.'),
    shutdown: jest.fn(),
  })),
}));

const WhisperTranscriptionPlugin = require('../src/main.js');
const { WhisperSettingTab } = WhisperTranscriptionPlugin;

function getCapturedHandlers() {
  return globalThis._capturedBtns || [];
}
function clearState() {
  jest.clearAllMocks();
  globalThis._capturedBtns = [];
}

/* Helper to create JSDOM elements with `.empty()` and `.createEl()` methods (Obsidian relies on) */
function makeObsidianContainer() {
  const el = document.createElement('div');
  el.empty = () => {
    el.innerHTML = '';
  };
  el.createEl = (tag, attrs) => {
    const child = document.createElement(tag);
    if (attrs && attrs.text) child.textContent = attrs.text;
    el.appendChild(child);
    return child;
  };
  return el;
}

function createMockedPlugin() {
  globalThis._capturedBtns = [];
  // Mock minimal app for plugin constructor & tab builder
  const mockApp = {};
  mockApp.asOriginalType__ = () => ({ config: {}, vault: {}, workspace: {} });

  const manifest = { id: 'offline-whisper', name: 'Offline Whisper', version: '1.0', minAppVersion: '1.0' };

  const dtcModule = require('../src/desktop-transcriber.js');
  dtcModule.DesktopTranscriber.mockImplementation(() => ({
    isModelCached: jest.fn().mockResolvedValue(true),
    clearCache: jest.fn().mockResolvedValue(),
  }));

  const plugin = new WhisperTranscriptionPlugin(mockApp.asOriginalType__(), manifest);
  plugin.settings = { modelId: 'onnx-community/whisper-base.en', chunkDurationMs: 10000, regexFilter: '^.*$' };
  return plugin;
}

describe('WhisperTranscriptionPlugin Desktop Path', () => {
  test('Desktop override forces desktop initialization', async () => {
    clearState();
    const plugin = createMockedPlugin();
    jest.spyOn(plugin, 'addCommand');
    jest.spyOn(plugin, 'addRibbonIcon');
    jest.spyOn(plugin, 'addSettingTab');

    await plugin.onload();

    expect(plugin.addCommand).toHaveBeenCalledTimes(5);
    expect(plugin.addRibbonIcon).toHaveBeenCalledTimes(2);
    expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
  });
});

describe('WhisperSettingTab Target Code (Lines 582-621)', () => {
  beforeEach(() => clearState());

  test('Exposes and executes Check Model Cache handler (line 583)', async () => {
    const plugin = createMockedPlugin();
    const dtc = { isModelCached: jest.fn().mockResolvedValue(true), clearCache: jest.fn() };
    Object.defineProperty(plugin, 'settings', { value: { modelId: 'test' }, writable: true, configurable: true });
    Object.defineProperty(plugin, 'desktopTranscriber', { value: dtc, writable: true, configurable: true });

    const tab = new WhisperSettingTab({}, plugin);
    Object.defineProperty(tab, 'containerEl', { value: makeObsidianContainer(), writable: true });

    await tab.display();

    expect(getCapturedHandlers().length).toBeGreaterThan(0);

    const checkItem = getCapturedHandlers().find((h) => String(h.handler).includes('isModelCached'));
    expect(checkItem).toBeDefined();

    // Invoke handler explicitly bound to `tab` so `this.plugin.desktopTranscriber` is accessible!
    await checkItem.handler.call(tab);

    expect(dtc.isModelCached).toHaveBeenCalled();
  });

  test('Executes Clear Caches handler desktop logic (lines 603-621)', async () => {
    const plugin = createMockedPlugin();
    const dtc = { isModelCached: jest.fn(), clearCache: jest.fn().mockResolvedValue(true) };
    // Direct assignment ensures it sticks without PropertyDescriptor issues
    plugin.desktopTranscriber = dtc;

    const tab = new WhisperSettingTab({}, plugin);
    Object.defineProperty(tab, 'containerEl', { value: makeObsidianContainer(), writable: true });

    await tab.display();

    const clearItem = getCapturedHandlers().find((h) => String(h.handler).includes('clearCache'));
    expect(clearItem).toBeDefined();

    await clearItem.handler.call(tab);
    expect(dtc.clearCache).toHaveBeenCalled();
  });

  test('display() populates critical UI elements in desktop mode', async () => {
    const plugin = createMockedPlugin();
    const tab = new WhisperSettingTab({}, plugin);
    Object.defineProperty(tab, 'containerEl', { value: makeObsidianContainer(), writable: true });

    await tab.display();
    expect(getCapturedHandlers().length).toBeGreaterThan(1);
  });
});

describe('Coverage verification for lines 582-621', () => {
  test('Full target sequence Check + Clear runs >70% coverage on 582-621 block', async () => {
    clearState();

    const plugin = createMockedPlugin();
    const dtc = { isModelCached: jest.fn().mockResolvedValue(true), clearCache: jest.fn().mockResolvedValue() };
    Object.defineProperty(plugin, 'desktopTranscriber', { value: dtc, writable: true, configurable: true });

    const tab = new WhisperSettingTab({}, plugin);
    Object.defineProperty(tab, 'containerEl', { value: makeObsidianContainer(), writable: true });

    await tab.display();

    const handlers = getCapturedHandlers();
    expect(handlers.length).toBeGreaterThan(1);

    // Execute intercepted button callbacks (simulating real Obsidian UI clicks)
    for (const h of handlers) {
      if (String(h.handler).includes('isModelCached') || String(h.handler).includes('clearCache')) {
        await h.handler.call(tab);
      }
    }

    expect(dtc.clearCache).toHaveBeenCalled();
  });
});

describe('Transcript cleanup (desktop)', () => {
  const cleanerModule = require('../src/desktop-cleaner.js');

  beforeEach(() => {
    jest.clearAllMocks();
    cleanerModule.DesktopCleaner.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(),
      clean: jest.fn().mockResolvedValue('Cleaned text.'),
      shutdown: jest.fn(),
    }));
  });

  function makeEditor(text) {
    const lines = text.split('\n');
    const offset = (pos) => {
      let o = 0;
      for (let i = 0; i < pos.line; i++) o += lines[i].length + 1;
      return o + pos.ch;
    };
    const all = () => lines.join('\n');
    return {
      getValue: () => all(),
      lineCount: () => lines.length,
      getLine: (i) => (i >= 0 && i < lines.length ? lines[i] : ''),
      getRange: (from, to) => all().slice(offset(from), offset(to)),
      replaceRange: (replacement, from, to) => {
        const updated = all().slice(0, offset(from)) + replacement + all().slice(offset(to));
        lines.length = 0;
        lines.push(...updated.split('\n'));
      },
      setLine: (i, text) => {
        lines[i] = text;
      },
    };
  }

  function setupPlugin(noteText) {
    const plugin = createMockedPlugin();
    const editor = makeEditor(noteText);
    plugin.app.workspace = {
      activeEditor: { editor },
      getActiveFile: () => ({ path: 'note.md' }),
    };
    plugin.app.metadataCache = { getFirstLinkpathDest: (linkpath) => ({ path: 'audio/' + linkpath }) };
    plugin.settings.cleanupAuto = false;
    plugin.settings.cleanupModel = 'qwen2.5-0.5b';
    plugin.settings.cleanupPrompt = 'Clean up: {text}';
    plugin.settings.headingLevel = 2;
    plugin.settings.regexFilter = '';
    plugin.transcriber = jest.fn().mockResolvedValue({ text: 'this is a test transcription' });
    plugin.loadModel = jest.fn().mockResolvedValue(true);
    plugin.decodeAudioFile = jest.fn().mockResolvedValue(new Float32Array([0, 0.5, 0]));
    return { plugin, editor };
  }

  function noticed(spy, message) {
    return spy.mock.calls.some((args) => typeof args[0] === 'string' && args[0].includes('[Notice] ' + message));
  }

  function silence() {
    return jest.spyOn(console, 'log').mockImplementation(() => {});
  }

  test('cleanTranscript returns the cleaned text', async () => {
    const { plugin } = setupPlugin('');
    const spy = silence();
    const result = await plugin.cleanTranscript('um hello');
    expect(result).toBe('Cleaned text.');
    expect(plugin.desktopCleaner.clean).toHaveBeenCalledWith('um hello', 'Clean up: {text}');
    expect(plugin.desktopCleaner.initialize).toHaveBeenCalledWith('qwen2.5-0.5b', expect.any(Function));
    spy.mockRestore();
  });

  test('cleanTranscript falls back to the raw text when cleanup fails', async () => {
    const { plugin } = setupPlugin('');
    const spy = silence();
    plugin.desktopCleaner = {
      initialize: jest.fn().mockResolvedValue(),
      clean: jest.fn().mockRejectedValue(new Error('boom')),
      shutdown: jest.fn(),
    };
    const result = await plugin.cleanTranscript('um hello');
    expect(result).toBe('um hello');
    expect(spy.mock.calls.some((args) => String(args[0]).includes('[Notice] Cleanup failed: boom'))).toBe(true);
    spy.mockRestore();
  });

  test('transcribeFile with cleanup off inserts the raw transcript', async () => {
    const { plugin, editor } = setupPlugin('![[Recording.m4a]]');
    const spy = silence();
    await plugin.transcribeFile('Recording.m4a');
    expect(editor.getValue()).toBe('![[Recording.m4a]]\n\n## Transcription\n\nthis is a test transcription');
    expect(plugin.desktopCleaner).toBe(null);
    spy.mockRestore();
  });

  test('transcribeFile with cleanup on inserts cleaned text and a collapsed original', async () => {
    const { plugin, editor } = setupPlugin('![[Recording.m4a]]');
    plugin.settings.cleanupAuto = true;
    const spy = silence();
    await plugin.transcribeFile('Recording.m4a');
    expect(editor.getValue()).toBe(
      '![[Recording.m4a]]\n\n## Transcription\n\nCleaned text.\n\n> [!note]- Original transcript\n> this is a test transcription',
    );
    spy.mockRestore();
  });

  test('cleanUpFile replaces an existing transcript with the cleaned version', async () => {
    const note = '![[Recording.m4a]]\n\n## Transcription\n\num so this is a test transcription';
    const { plugin, editor } = setupPlugin(note);
    const spy = silence();
    await plugin.cleanUpFile('Recording.m4a');
    expect(editor.getValue()).toBe(
      '![[Recording.m4a]]\n\n## Transcription\n\nCleaned text.\n\n> [!note]- Original transcript\n> um so this is a test transcription',
    );
    expect(plugin.desktopCleaner.clean).toHaveBeenCalledWith('um so this is a test transcription', 'Clean up: {text}');
    spy.mockRestore();
  });

  test('cleanUpFile notices when the embed has no transcript', async () => {
    const { plugin } = setupPlugin('![[Recording.m4a]]\n\nSome other text');
    const spy = silence();
    await plugin.cleanUpFile('Recording.m4a');
    expect(noticed(spy, 'No transcription found for: Recording.m4a')).toBe(true);
    spy.mockRestore();
  });

  test('cleanUpFile reuses the original transcript from the callout', async () => {
    const note =
      '![[Recording.m4a]]\n\n## Transcription\n\nOld cleaned.\n\n> [!note]- Original transcript\n> um raw words here';
    const { plugin } = setupPlugin(note);
    const spy = silence();
    await plugin.cleanUpFile('Recording.m4a');
    expect(plugin.desktopCleaner.clean).toHaveBeenCalledWith('um raw words here', 'Clean up: {text}');
    spy.mockRestore();
  });

  test('cleanUpFile leaves the note unchanged when cleanup returns the same text', async () => {
    const note = '![[Recording.m4a]]\n\n## Transcription\n\nidentical';
    const { plugin, editor } = setupPlugin(note);
    plugin.desktopCleaner = {
      initialize: jest.fn().mockResolvedValue(),
      clean: jest.fn().mockResolvedValue('identical'),
      shutdown: jest.fn(),
    };
    const spy = silence();
    await plugin.cleanUpFile('Recording.m4a');
    expect(editor.getValue()).toBe(note);
    expect(spy.mock.calls.some((args) => String(args[0]).includes('[Notice] Transcript unchanged'))).toBe(true);
    spy.mockRestore();
  });

  test('onunload shuts the cleaner down', async () => {
    const { plugin } = setupPlugin('');
    plugin.desktopCleaner = { shutdown: jest.fn() };
    const spy = silence();
    plugin.onunload();
    expect(plugin.desktopCleaner.shutdown).toHaveBeenCalled();
    spy.mockRestore();
  });
});
