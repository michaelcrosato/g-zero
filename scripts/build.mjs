/** Build the complete offline game from local source and embedded engine files. */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const read = (file) => readFile(path.join(ROOT, file), 'utf8');
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const safeJSON = (value) =>
  JSON.stringify(value).replace(/</g, '\\u003c');
// This is the same UTF-16 checksum that the boot loader checks in the browser.
export function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The local modules use single-line imports and named declaration exports only. */
export function stripModule(source) {
  const code = source
    .replace(/^import[^\n]+\n/gm, '')
    .replace(/^export (?=(?:async )?function |const |class )/gm, '');
  if (/^\s*(?:import |export )/m.test(code))
    throw new Error(
      'Unsupported module syntax. Update the build script before adding it.',
    );
  return code.trim();
}
const combine = async (files) =>
  (await Promise.all(files.map(read))).map(stripModule).join('\n\n') + '\n';
const script = (id, source, type = 'text/javascript') =>
  `<script id="${id}" type="${type}">\n${source.replace(/<\/script/gi, '<\\/script')}\n</script>`;
const data = (id, value) => script(id, safeJSON(value), 'application/json');
const payload = (source, version) => ({
  version,
  checksum: checksum(source),
  bytes: Buffer.byteLength(source),
  source,
});

export async function compile({ hosted = false } = {}) {
  const config = JSON.parse(await read('game.config.json'));
  const pkg = JSON.parse(await read('package.json'));
  if (pkg.name !== config.id || pkg.version !== config.version)
    throw new Error('Game and package metadata do not match.');
  const manifest = JSON.parse(await read('vendor/manifest.json'));
  const runtime = {};
  for (const [id, version] of [
    ['three-core', '0.181.0'],
    ['three-webgpu', '0.181.0'],
    ['rapier', '0.19.3'],
  ]) {
    const entry = manifest[id];
    if (
      !entry ||
      entry.version !== version ||
      path.basename(entry.file) !== entry.file
    )
      throw new Error(`Invalid vendor manifest: ${id}`);
    const source = await read('vendor/' + entry.file);
    if (
      Buffer.byteLength(source) !== entry.bytes ||
      sha256(source) !== entry.sha256
    )
      throw new Error(`Vendor file is damaged: ${entry.file}`);
    runtime[id] = payload(source, version);
  }
  if (!runtime.rapier.source.includes('AGFzbQ'))
    throw new Error('The Rapier payload must contain its WebAssembly data.');
  if (!runtime['three-webgpu'].source.includes('./three.core.min.js'))
    throw new Error('The Three.js core import is missing.');

  const game =
    (await combine([
      'src/core.js',
      'src/assets.js',
      'src/renderer.js',
      'src/ui.js',
      'src/game.js',
    ])) + '\nexport { prepareGame, setupDisplayControls };\n';
  const engines =
    (await combine(['src/renderer.js', 'boot/engines.js'])) +
    '\nexport { selectRenderer, physicsCheck, renderCheck };\n';
  runtime.engines = payload(engines, config.version);
  runtime.game = payload(game, config.version);
  const view = {
    html: await read('src/template.html'),
    css: await read('src/style.css'),
  };
  const viewText = safeJSON(view);
  const [
    emergency,
    core,
    display,
    hooks,
    css,
    document,
    gameLicense,
    threeLicense,
    rapierLicense,
  ] = await Promise.all(
    [
      'boot/emergency.js',
      'boot/core.js',
      'boot/view.js',
      'boot/hooks.js',
      'boot/view.css',
      'boot/document.html',
      'LICENSE',
      'licenses/Three-MIT.txt',
      'licenses/Apache-2.0.txt',
    ].map(read),
  );
  // Include all runtime sources and licenses. Do not include timestamps, paths, or host data.
  const digest = sha256(
    JSON.stringify({
      config,
      runtime,
      view,
      emergency,
      core,
      display,
      hooks,
      css,
      document,
      gameLicense,
      threeLicense,
      rapierLicense,
    }),
  );
  const bootConfig = {
    id: config.id,
    name: config.name,
    version: config.version,
    buildId: config.buildPrefix + '-' + digest.slice(0, 10).toUpperCase(),
    mode: hosted ? 'hosted' : 'offline',
    packaged: !hosted,
    viewChecksum: checksum(viewText),
  };
  const assets = {};
  const assetInfo = {};
  const scripts = [
    script('gb-emergency-code', emergency),
    data('gb-config', bootConfig),
    script('gb-core-code', core),
    script('gb-view-code', display),
  ];
  for (const [id, contents] of Object.entries(runtime)) {
    let descriptor = contents;
    if (hosted) {
      const { source, ...metadata } = contents;
      const digest = sha256(source);
      const url = '/assets/' + id + '-' + digest.slice(0, 16) + '.mjs';
      assets[url] = source;
      descriptor = { ...metadata, url };
      assetInfo[id] = { ...descriptor, sha256: digest };
    }
    scripts.push(data('gb-payload-' + id, descriptor));
  }
  scripts.push(
    data('gb-game-view', view),
    data('gb-licenses', {
      game: gameLicense,
      three: threeLicense,
      rapier: rapierLicense,
    }),
    script('gb-hooks-code', hooks, 'module'),
  );
  const replacements = {
    NAME: config.name,
    VERSION: config.version,
    BUILD: bootConfig.buildId,
    BOOT_CSS: css,
    SCRIPTS: scripts.join('\n'),
  };
  // The hosted loader may fetch only this site's hashed engine and game files.
  const template = hosted
    ? document.replace("connect-src 'none'", "connect-src 'self'")
    : document;
  const html = template.replace(/@@([A-Z_]+)@@/g, (_, key) => {
    if (!(key in replacements))
      throw new Error('Unknown document token: ' + key);
    return replacements[key];
  });
  if (/@@[A-Z_]+@@/.test(html))
    throw new Error('A source placeholder remains in the output.');
  const build = {
    ...bootConfig,
    file: 'index.html',
    bytes: Buffer.byteLength(html),
    sha256: sha256(html),
    engines: pkg.engineVersions,
  };
  if (hosted) build.assets = assetInfo;
  return { html, build, runtime, assets };
}

async function main() {
  const { html, build } = await compile();
  const info = JSON.stringify(build, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if ((await read('index.html')) !== html)
      throw new Error(
        'index.html differs from source. Run npm run build and commit the output.',
      );
    if ((await read('build-info.json')) !== info)
      throw new Error(
        'build-info.json differs from source. Run npm run build.',
      );
    console.log(
      `PASS / reproducible offline build / ${build.buildId} / ${build.bytes} bytes`,
    );
  } else {
    const hosted = await compile({ hosted: true });
    // Clear old hashed assets so only the current public build is deployed.
    await rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
    await mkdir(path.join(ROOT, 'dist'), { recursive: true });
    await mkdir(path.join(ROOT, 'dist/assets'), { recursive: true });
    await writeFile(path.join(ROOT, 'index.html'), html);
    await writeFile(path.join(ROOT, 'dist/g-zero.html'), html);
    await writeFile(path.join(ROOT, 'build-info.json'), info);
    await writeFile(path.join(ROOT, 'dist/index.html'), hosted.html);
    await writeFile(
      path.join(ROOT, 'dist/build-info.json'),
      JSON.stringify(hosted.build, null, 2) + '\n',
    );
    await Promise.all(
      Object.entries(hosted.assets).map(([url, source]) =>
        writeFile(path.join(ROOT, 'dist', url), source),
      ),
    );
    console.log(
      `BUILT / ${build.buildId} / offline ${build.bytes} bytes / hosted entry ${hosted.build.bytes} bytes / ${Object.keys(hosted.assets).length} hashed assets`,
    );
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error('BUILD-FAIL / ' + error.message);
    process.exitCode = 1;
  });
}
