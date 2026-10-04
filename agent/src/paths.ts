import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Project root, whether we run from the source tree or from .mastra/output. */
function findRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const ROOT = findRoot();
export const path = (...p: string[]) => join(ROOT, ...p);
