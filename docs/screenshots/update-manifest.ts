// Stamp per-image evidence metadata into docs/screenshots/screenshots.json.
// Run after any change to the screenshot set or after re-anchoring the report:
//   node docs/screenshots/update-manifest.ts
// The image hashes are recomputed from the PNG bytes on disk, so the manifest always
// describes exactly the files the report embeds. Capture-session metadata (browser,
// viewport, protocol, nav paths) was recorded at capture time and is preserved as-is.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifestPath = resolve(import.meta.dirname, 'screenshots.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pngBytes = (file: string) => readFileSync(resolve(import.meta.dirname, file));
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
// PNG IHDR: width and height are the first two big-endian uint32 values after the signature.
const dimensions = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

for (const shot of manifest.screenshots) {
  const bytes = pngBytes(shot.file);
  shot.imageSha256 = sha(bytes);
  shot.imagePixels = dimensions(bytes);
  shot.captureSession = manifest.capturedAt;
  shot.locale = manifest.uiLanguage;
  shot.browserVersion = `${manifest.browser.name} ${manifest.browser.version}`;
  shot.viewport = manifest.viewport;
  shot.fixtureHash = manifest.fixtures[shot.fixture]?.directoryHash ?? null;
}
manifest.manifestVersion = 2;
manifest.manifestNote = 'Every screenshot entry carries its own image SHA-256, pixel size, fixture, fixture hash, locale, browser version, viewport and capture-session timestamp, so each figure in the report can be traced on its own without reading the protocol section.';
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`stamped ${manifest.screenshots.length} screenshot entries in ${manifestPath}`);
