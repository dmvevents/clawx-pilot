// @vitest-environment node
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveFormsResourcePath } from '../../electron/services/forms-browser-v2/paths';

const originalCwd = process.cwd();
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
const tempRoots: string[] = [];

function makeRoot(name: string) {
  const root = join(tmpdir(), `clawx-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

function writeFixture(root: string, relativePath: string) {
  const filePath = join(root, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, 'fixture');
  return filePath;
}

function setResourcesPath(value: string | undefined) {
  if (value) {
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value,
    });
  } else if (originalResourcesPath) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  } else {
    delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  }
}

afterEach(() => {
  process.chdir(originalCwd);
  setResourcesPath(undefined);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('forms-browser-v2 resource path resolution', () => {
  it('keeps source-checkout resources working in development', () => {
    const root = makeRoot('forms-dev');
    const relativePath = 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt';
    const expected = writeFixture(root, relativePath);

    process.chdir(root);
    setResourcesPath(undefined);

    expect(realpathSync(resolveFormsResourcePath(relativePath)!)).toBe(realpathSync(expected));
  });

  it('finds packaged extraResources when process.cwd() is not the repo root', () => {
    const cwd = makeRoot('forms-cwd');
    const resources = makeRoot('forms-resources');
    const relativePath = 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt';
    const expected = writeFixture(resources, relativePath);

    process.chdir(cwd);
    setResourcesPath(resources);

    expect(realpathSync(resolveFormsResourcePath(relativePath)!)).toBe(realpathSync(expected));
  });
});
