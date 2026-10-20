const { downloadFile, extractZip, findExecutable, getNodeModules } = require('./desktop-transcriber.js');

const LLAMA_RELEASES_URL = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30';

// Smallest instruct models that reliably clean up dictated text.
const CLEANER_MODELS = {
  'qwen2.5-0.5b': {
    fileName: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
  },
  'qwen2.5-1.5b': {
    fileName: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  },
};

const CONTEXT_SIZE = 8192;
const MAX_OUTPUT_TOKENS = 2048;

function log(message, data) {
  const timestamp = new Date().toISOString().substr(11, 12);
  if (data !== undefined) {
    console.log(`[Cleaner ${timestamp}] ${message}`, data);
  } else {
    console.log(`[Cleaner ${timestamp}] ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAssetRegex() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') {
    return /^llama-b\d+-bin-win-cpu-x64\.zip$/;
  }
  if (process.platform === 'darwin') {
    return new RegExp('^llama-b\\d+-bin-macos-' + arch + '\\.tar\\.gz$');
  }
  return new RegExp('^llama-b\\d+-bin-ubuntu-' + arch + '\\.tar\\.gz$');
}

async function findLatestLlamaServerAsset() {
  const { https } = getNodeModules();
  log('Fetching latest llama.cpp release info');
  const assetRegex = getAssetRegex();
  const response = await new Promise((resolve, reject) => {
    https
      .get(
        LLAMA_RELEASES_URL,
        { headers: { 'User-Agent': 'ObsidianWhisperPlugin', Accept: 'application/vnd.github+json' } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, data }));
        },
      )
      .on('error', reject);
  });
  if (response.status !== 200) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  const releases = JSON.parse(response.data);
  for (const release of releases) {
    const asset = (release.assets || []).find((a) => assetRegex.test(a.name));
    if (asset) {
      log('Using llama.cpp release ' + release.tag_name + ': ' + asset.name);
      return asset.browser_download_url;
    }
  }
  throw new Error('No llama.cpp release asset found for this platform');
}

class DesktopCleaner {
  constructor(plugin) {
    this.plugin = plugin;
    this.serverPath = null;
    this.modelPath = null;
    this.proc = null;
    this.port = null;
    this.lastError = '';
  }

  getNodeModules() {
    if (!this.node) {
      this.node = getNodeModules();
    }
    return this.node;
  }

  getPluginDir() {
    const { path } = this.getNodeModules();
    return path.join(this.plugin.app.vault.adapter.basePath, this.plugin.manifest.dir);
  }

  async ensureDir(dir) {
    const { fs } = this.getNodeModules();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async initialize(modelId, progressCallback) {
    const { path, fs } = this.getNodeModules();
    const pluginDir = this.getPluginDir();
    const binDir = path.join(pluginDir, 'bin');
    const modelsDir = path.join(pluginDir, 'models');
    await this.ensureDir(binDir);
    await this.ensureDir(modelsDir);

    const execNames = process.platform === 'win32' ? ['llama-server.exe'] : ['llama-server'];
    this.serverPath = findExecutable(binDir, execNames);
    if (!this.serverPath) {
      progressCallback({ status: 'downloading', message: 'Downloading cleanup executable' });
      const url = await findLatestLlamaServerAsset();
      const archivePath = path.join(binDir, url.endsWith('.zip') ? 'llama.zip' : 'llama.tar.gz');
      log('Downloading llama-server from: ' + url);
      await downloadFile(url, archivePath, (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        progressCallback({ status: 'progress', message: `Downloading cleanup executable: ${pct}%` });
      });
      await extractZip(archivePath, binDir, process.platform);
      try {
        fs.unlinkSync(archivePath);
      } catch (e) {}
      this.serverPath = findExecutable(binDir, execNames);
      if (!this.serverPath) {
        throw new Error('Could not find llama-server executable after extraction');
      }
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(this.serverPath, 0o755);
    }

    const model = CLEANER_MODELS[modelId] || CLEANER_MODELS['qwen2.5-0.5b'];
    const modelPath = path.join(modelsDir, model.fileName);
    if (!fs.existsSync(modelPath)) {
      progressCallback({ status: 'downloading', message: 'Downloading cleanup model: ' + model.fileName });
      await downloadFile(model.url, modelPath, (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        progressCallback({ status: 'progress', message: `Downloading cleanup model: ${pct}%` });
      });
    }
    if (this.modelPath && this.modelPath !== modelPath) {
      this.shutdown();
    }
    this.modelPath = modelPath;
    progressCallback({ status: 'ready' });
  }

  request(method, requestPath, body, timeoutMs = 600000) {
    const { http } = this.getNodeModules();
    return new Promise((resolve, reject) => {
      const data = body === null ? null : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          path: requestPath,
          method,
          headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => {
            if (res.statusCode >= 400) {
              reject(new Error(`llama-server HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
              return;
            }
            try {
              resolve(JSON.parse(text));
            } catch (e) {
              reject(new Error('Invalid JSON from llama-server'));
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('llama-server request timed out')));
      if (data) {
        req.write(data);
      }
      req.end();
    });
  }

  async ensureServer() {
    if (this.proc && !this.proc.killed) {
      return;
    }
    if (!this.serverPath || !this.modelPath) {
      throw new Error('Cleaner not initialized');
    }
    const { spawn } = this.getNodeModules();
    this.port = 38300 + Math.floor(Math.random() * 700);
    log('Starting llama-server on port ' + this.port);
    this.lastError = '';
    this.proc = spawn(this.serverPath, [
      '-m',
      this.modelPath,
      '-c',
      String(CONTEXT_SIZE),
      '-np',
      '1',
      '--host',
      '127.0.0.1',
      '--port',
      String(this.port),
    ]);
    this.proc.stderr.on('data', (data) => {
      this.lastError = (this.lastError + data.toString()).slice(-4000);
    });
    this.proc.on('exit', (code) => {
      log('llama-server exited with code ' + code);
      this.proc = null;
    });
    this.proc.on('error', (error) => {
      log('llama-server spawn error', error);
      this.lastError = error.message;
      this.proc = null;
    });
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (!this.proc) {
        throw new Error('llama-server failed to start: ' + this.lastError.split('\n').pop());
      }
      try {
        const health = await this.request('GET', '/health', null, 5000);
        if (health && health.status === 'ok') {
          log('llama-server ready');
          return;
        }
      } catch (e) {}
      await sleep(500);
    }
    throw new Error('Timed out waiting for llama-server');
  }

  async clean(text, promptTemplate) {
    await this.ensureServer();
    const prompt = promptTemplate.includes('{text}')
      ? promptTemplate.split('{text}').join(text)
      : promptTemplate + '\n\n' + text;
    const tokenized = await this.request('POST', '/tokenize', { content: prompt }, 30000);
    const promptTokens = tokenized && tokenized.tokens ? tokenized.tokens.length : Math.ceil(prompt.length / 4);
    const limit = CONTEXT_SIZE - MAX_OUTPUT_TOKENS;
    if (promptTokens > limit) {
      throw new Error(`Transcript too long for cleanup (${promptTokens} tokens, limit ${limit})`);
    }
    const response = await this.request('POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
    const choice = response && response.choices && response.choices[0];
    return choice && choice.message ? (choice.message.content || '').trim() : '';
  }

  shutdown() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch (e) {}
      this.proc = null;
    }
    this.port = null;
  }
}

module.exports = { DesktopCleaner, CLEANER_MODELS };
