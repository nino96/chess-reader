import { readFile, writeFile } from 'node:fs/promises';

/** A reproduction may verify identical bytes but may never replace a frozen input. */
export async function writeImmutable(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    if (!Buffer.from(await readFile(path)).equals(Buffer.from(bytes)))
      throw new Error('Refusing to replace immutable experiment artifact');
  }
}
