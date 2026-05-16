import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../../shared/canonical-json.js';
import type {
  FlowSource,
  FlowSourceDescriptor,
  FlowSourceFingerprint,
  FlowSourceWarning,
  SaveOptions,
} from '../../shared/flow-source.js';
import { FlowsJsonSchema, type FlowsJson } from '../../shared/flows-json.js';
import { canonicalHash } from '../../shared/hash.js';
import { safeWrite } from '../filesystem/safe-write.js';

export interface FileFlowSourceOptions {
  path: string;
}

/**
 * `FlowSource` backed by a local `flows.json` file. Used by offline tests and
 * by callers that don't need a running Node-RED. `rev` is always `null`.
 */
export class FileFlowSource implements FlowSource {
  constructor(private readonly opts: FileFlowSourceOptions) {}

  async load(): Promise<{ flows: FlowsJson; rev: string | null }> {
    const raw = await readFile(this.opts.path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const flows = FlowsJsonSchema.parse(parsed);
    return { flows, rev: null };
  }

  async save(flows: FlowsJson, _opts: SaveOptions): Promise<{ rev: string }> {
    void _opts;
    const json = canonicalJson(flows);
    await safeWrite(this.opts.path, json);
    return { rev: '' };
  }

  async fingerprint(): Promise<FlowSourceFingerprint> {
    const { flows } = await this.load();
    return { sha256: canonicalHash(flows), rev: null };
  }

  describe(): FlowSourceDescriptor {
    return { kind: 'file', target: this.opts.path };
  }

  /**
   * Detect Node-RED's `editorTheme.projects.enabled` footgun: when projects
   * mode is on, the runtime ignores `flowFile` and reads
   * `<userDir>/projects/<name>/flow.json` instead. A FileFlowSource pointed at
   * `<userDir>/flows.json` would silently read the pre-projects-mode file.
   */
  async inspectWarnings(): Promise<readonly FlowSourceWarning[]> {
    const warnings: FlowSourceWarning[] = [];
    const parent = path.dirname(this.opts.path);
    const projectsDir = path.join(parent, 'projects');
    let projectsHasContent = false;
    try {
      const st = await stat(projectsDir);
      if (st.isDirectory()) {
        const entries = await readdir(projectsDir);
        projectsHasContent = entries.length > 0;
      }
    } catch {
      // no projects/ sibling — happy path
    }
    if (!projectsHasContent) return warnings;

    let flowFileExists = false;
    try {
      await stat(this.opts.path);
      flowFileExists = true;
    } catch {
      flowFileExists = false;
    }

    warnings.push({
      code: 'project-mode-suspected',
      message:
        `A 'projects/' sibling directory at ${projectsDir} suggests Node-RED ` +
        `editorTheme.projects.enabled is on for this userDir. When projects ` +
        `mode is enabled, flows live at <userDir>/projects/<name>/flow.json, ` +
        `not at ${this.opts.path}` +
        (flowFileExists ? ' (which exists but may be stale).' : ' (which does not exist).'),
      hint:
        'Either point FLOW_FILE_PATH at the active project flow.json under projects/<name>/flow.json, ' +
        'or use FLOW_SOURCE=admin-api so the runtime resolves the correct file.',
    });
    return warnings;
  }
}
