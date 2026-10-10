// Leakage scan for publication artefacts.
// Usage: node tests/check-public-output.mjs [distDir]
// Fails (exit 1) if the build output or the tracked git files contain anything
// that must stay private: raw data, identifier mappings, statistics, QA report,
// internal notes, or references to the private data folder.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const site = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = resolve(site, '..');
const dist = resolve(process.argv[2] ?? join(site, 'dist'));

// The source dataset name is assembled so this file does not match itself.
const sourceName = new RegExp(['deal', 'scan'].join(''), 'i');
const sourceColumns = new RegExp(['Len', 'der_Share|Tran', 'che_Amount|LPC_', 'Tranche'].join(''), 'i');
const domainWords = new RegExp('\\b(' + ['len', 'd(er|ers|ing|s)?|bor', 'row\\w*|lo', 'ans?|syndic', 'at\\w*|super', 'vis\\w*|cre', 'dit\\w*|fin', 'anc\\w*'].join('') + ')\\b', 'i');
const sourcePeriod = new RegExp(['origination ', 'cohort'].join(''), 'i');
const forbiddenNames = [
  /\.csv$/i, /\.xlsx$/i, /identifier_mapping/i, /statistics\.json$/i, /report\.html$/i,
  /^AGENTS\.md$/i, /^CLAUDE\.md$/i, /(^|\/)memory\//i, /(^|\/)docs\//i, /stage_viewer_network/i,
  /\.env/i, /\.pem$/i, /\.key$/i, sourceName, /(^|\/)scripts\//i,
];
const forbiddenContent = [
  sourceName, sourcePeriod, sourceColumns, domainWords,
  /data\/private/i, /processed_2025/i, new RegExp(['deal', 'scan20\d\d'].join(''), 'i'), /identifier_mapping/i,
  /source_sha256/i, /[A-Za-z]:\\Users\\/i, /\/Users\/[a-z]/i, /ghp_[A-Za-z0-9]{20,}/, /gho_[A-Za-z0-9]{20,}/,
];
const privatePathPatterns = forbiddenContent.filter(p => /private|processed|scan20|identifier|sha256/i.test(p.source));
const textExt = /\.(html|js|mjs|css|json|svg|txt|md|map|xml|webmanifest)$/i;

const failures = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function scanFile(path, label) {
  const rel = relative(label === 'dist' ? dist : repo, path).replace(/\\/g, '/');
  for (const pattern of forbiddenNames) {
    if (pattern.test(rel)) failures.push(`${label}: forbidden file name ${rel}`);
  }
  if (!textExt.test(rel)) return;
  const content = readFileSync(path, 'utf8');
  for (const pattern of forbiddenContent) {
    if (pattern.test(content)) failures.push(`${label}: ${rel} matches ${pattern}`);
  }
}

// 1. Build output.
let distFiles = [];
try {
  distFiles = walk(dist);
} catch {
  failures.push(`dist: ${dist} not found; run the build first`);
}
distFiles.forEach(file => scanFile(file, 'dist'));
if (distFiles.some(f => /network\.json$/i.test(f))) {
  console.log('note: dist contains data/network.json (the public graph asset). Only acceptable after owner authorisation.');
}

// 2. Tracked git files (what a push would publish).
try {
  const tracked = execSync('git ls-files -z', { cwd: repo }).toString('utf8').split('\0').filter(Boolean);
  for (const rel of tracked) {
    const full = join(repo, rel);
    const posix = rel.replace(/\\/g, '/');
    for (const pattern of forbiddenNames) {
      if (pattern.test(posix)) failures.push(`git: forbidden tracked file ${posix}`);
    }
    if (textExt.test(posix) || /\.(ts|py|ps1|yml|yaml|gitignore|gitattributes)$/i.test(posix)) {
      const content = readFileSync(full, 'utf8');
      // Preparation scripts and the checks themselves legitimately name the private
      // input paths. Everything they contain must still be free of secrets and user paths.
      const namesPrivateInputs = /^(scripts\/|site\/tests\/|\.github\/workflows\/)/.test(posix);
      for (const pattern of forbiddenContent) {
        if (namesPrivateInputs && privatePathPatterns.includes(pattern)) continue;
        if (pattern.test(content)) failures.push(`git: ${posix} matches ${pattern}`);
      }
    }
  }
} catch (error) {
  failures.push(`git: tracked-file scan could not run (${error instanceof Error ? error.message.split('\n')[0] : error})`);
}

if (failures.length) {
  console.error('Leakage check FAILED:');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`Leakage check passed: ${distFiles.length} build files and tracked git files are clean.`);
