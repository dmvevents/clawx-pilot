import { existsSync } from 'node:fs';
import { join } from 'node:path';

function candidateRoots(): string[] {
  const roots = [process.cwd()];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    roots.push(resourcesPath);
    roots.push(join(resourcesPath, 'app.asar.unpacked'));
    roots.push(join(resourcesPath, 'resources'));
  }
  return [...new Set(roots)];
}

export function resolveFormsResourcePath(relativePath: string): string | null {
  for (const root of candidateRoots()) {
    const candidate = join(root, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function formsResourcePath(relativePath: string): string {
  return resolveFormsResourcePath(relativePath) ?? join(process.cwd(), relativePath);
}
