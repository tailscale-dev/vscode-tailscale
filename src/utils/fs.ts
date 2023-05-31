import { promises as fs } from 'fs';

export async function fileExists(path: string) {
  return !!(await fs.stat(path).catch(() => false));
}
