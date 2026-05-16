import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/tab-divergence.js';

const FIXTURE = path.join(__dirname, '../../../../fixtures/broken/tab-divergence.flows.json');

describe('tab-divergence', () => {
  it('passes when labels are unique and groups stay on tab', () => {
    expect(
      check([
        { id: 'a', type: 'tab', label: 'A' },
        { id: 'b', type: 'tab', label: 'B' },
      ] as never),
    ).toEqual([]);
  });

  it('flags both duplicate labels and cross-tab group refs in fixture', async () => {
    const flows = JSON.parse(await readFile(FIXTURE, 'utf8')) as never;
    const out = check(flows);
    const dups = out.filter((d) => d.severity === 'warning');
    const cross = out.filter((d) => d.severity === 'error');
    expect(dups.length).toBe(2); // two tabs sharing the label
    expect(cross.length).toBe(1);
    expect(cross[0]?.context?.memberTab).toBe('tabbbbbbbbbbbbbbb');
  });
});
