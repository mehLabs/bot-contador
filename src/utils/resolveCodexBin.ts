import fs from 'node:fs';
import path from 'node:path';

export function resolveCodexBin(configured: string | undefined): string {
  if (configured && configured !== 'codex') return configured;

  const fromPath = findOnPath(process.platform === 'win32' ? 'codex.exe' : 'codex');
  if (fromPath) return fromPath;

  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const extensionRoot = path.join(userProfile, '.vscode', 'extensions');
      const found = findCodexInVsCodeExtension(extensionRoot);
      if (found) return found;
    }
  }

  return configured ?? 'codex';
}

function findOnPath(executable: string): string | undefined {
  const pathValue = process.env.PATH ?? '';
  for (const part of pathValue.split(path.delimiter)) {
    if (!part) continue;
    const candidate = path.join(part, executable);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function findCodexInVsCodeExtension(extensionRoot: string): string | undefined {
  if (!fs.existsSync(extensionRoot)) return undefined;
  const extensionDirs = fs
    .readdirSync(extensionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
    .map((entry) => path.join(extensionRoot, entry.name))
    .sort()
    .reverse();

  for (const extensionDir of extensionDirs) {
    const candidate = path.join(extensionDir, 'bin', 'windows-x86_64', 'codex.exe');
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
