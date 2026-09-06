import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeImmutable } from '../immutable-artifact.ts';

await test('reproduction verifies identical bytes and rejects replacement without data loss', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'training-immutable-'));
  try {
    const path = join(directory, 'artifact');
    await writeImmutable(path, Buffer.from('frozen'));
    await writeImmutable(path, Buffer.from('frozen'));
    await assert.rejects(writeImmutable(path, Buffer.from('changed')), /Refusing to replace/);
    assert.equal(await readFile(path, 'utf8'), 'frozen');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
