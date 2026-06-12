import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'tmp', 'coverage', '.next']);
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.js',
  '.mjs',
  '.ts',
  '.tsx',
  '.json',
  '.html',
  '.css',
  '.yml',
  '.yaml',
  '.txt'
]);

const posixUserHomePattern = `/${'Users'}/[^\\s"'<>|]+`;
const windowsUserHomePattern = `[A-Za-z]:\\\\${'Users'}\\\\[^\\s"'<>|]+`;
const productionWebroot = `/${'www'}/${'wwwroot'}`;
const dotEnvPattern = `(?<![A-Za-z0-9_$])\\.${'env'}(?:\\.${'local'})?\\b`;
const credentialKeyPattern = [
  'openai[_-]?api[_-]?key',
  'supabase[_-]?service[_-]?role',
  'private[_-]?key',
  'password',
  'api[_-]?secret',
  'client[_-]?secret',
  '(?:access|refresh|auth|bearer)[_-]?token'
].join('|');
const knownServerIps = [
  ['106', '54', '61', '5'].join('.'),
  ['103', '236', '96', '82'].join('.')
];

const PATTERNS = [
  { id: 'local-user-path', pattern: new RegExp(`(?<!\\\\)${posixUserHomePattern}`, 'g') },
  { id: 'windows-user-path', pattern: new RegExp(windowsUserHomePattern, 'g') },
  { id: 'production-webroot', pattern: new RegExp(productionWebroot.replaceAll('/', '\\/'), 'g') },
  { id: 'env-file-reference', pattern: new RegExp(dotEnvPattern, 'g') },
  { id: 'credential-assignment', pattern: new RegExp(`(?<![A-Za-z0-9_$])(?:${credentialKeyPattern})(?![A-Za-z0-9_$])\\s*[:=]`, 'gi') },
  { id: 'known-server-ip', pattern: new RegExp(`\\b(?:${knownServerIps.map((ip) => ip.replaceAll('.', '\\.')).join('|')})\\b`, 'g') }
];

const BRAND_LITERAL_ALLOWED_FILES = new Set([
  'apps/cover-machine/DESIGN.md',
  'apps/mv-studio/DESIGN.md',
  'docs/openfad-release-spec.zh-CN.md',
  'docs/verification/mv-0.1.0.md',
  'scripts/scan-public-safety.mjs',
  'scripts/scan-public-safety.test.mjs'
]);

const BRAND_LITERAL_PATTERNS = [
  /\[FAD\]/g,
  /_FAD\b/g,
  /\bFAD_DEBUG\b/g,
  /\bFAD_HTML2CANVAS_READY\b/g,
  /\bFAD_CREATOR_CONTEXT\b/g,
  /\bFAD Records Release\b/g,
  /\bUntitled FAD MV\b/g,
  /\bFAD Sample Vol\b/g,
  /\bFAD Promo Cut\b/g,
  /\bFAD MV(?:\s|$)/g,
  /\bartist:\s*['"]FAD['"]/g,
  /\/work\/FAD\b/g,
  />FAD</g,
  /(?<!open)FAD 中文/g,
  /(?<!open)FAD 自定义/g
];

const walk = async (dir, files = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
};

export const scanPublicSafety = async (scanRoot = root) => {
  const files = await walk(scanRoot);
  const findings = [];

  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;
    const info = await stat(file);
    if (info.size > 1024 * 1024) continue;
    const text = await readFile(file, 'utf8');
    const relativeFile = path.relative(scanRoot, file);

    for (const check of PATTERNS) {
      for (const match of text.matchAll(check.pattern)) {
        findings.push({
          id: check.id,
          file: relativeFile,
          index: match.index ?? 0
        });
      }
    }

    if (!BRAND_LITERAL_ALLOWED_FILES.has(relativeFile)) {
      for (const pattern of BRAND_LITERAL_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          findings.push({
            id: 'private-brand-literal',
            file: relativeFile,
            index: match.index ?? 0
          });
        }
      }
    }
  }

  return { ok: findings.length === 0, findings };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await scanPublicSafety(root);
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log('public safety scan passed');
}
