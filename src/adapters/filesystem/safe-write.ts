import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Atomically writes `content` to `targetPath`: writes a sibling tmpfile, then
 * renames over the target. Creates parent directories as needed.
 */
export async function safeWrite(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  await writeFile(tmpPath, content, { encoding: 'utf8' });
  await rename(tmpPath, targetPath);
}
