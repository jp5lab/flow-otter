import type {
  FlowSource,
  FlowSourceDescriptor,
  FlowSourceFingerprint,
  FlowSourceWarning,
  SaveOptions,
} from '../../shared/flow-source.js';
import type { FlowsJson } from '../../shared/flows-json.js';
import { canonicalHash } from '../../shared/hash.js';
import type { NodeRedClient } from '../nodered/client.js';
import { DEFAULT_DEPLOY_MODE } from '../nodered/deploy.js';

/**
 * `FlowSource` backed by a running Node-RED Admin API. Drift detection and
 * deployment-mode handling live in the calling tool (so they're auditable);
 * this class is a thin pass-through to the HTTP client.
 */
export class AdminApiFlowSource implements FlowSource {
  constructor(private readonly client: NodeRedClient) {}

  async load(): Promise<{ flows: FlowsJson; rev: string | null }> {
    return this.client.getFlows();
  }

  async save(flows: FlowsJson, opts: SaveOptions): Promise<{ rev: string }> {
    return this.client.postFlows(flows, {
      rev: opts.expectedRev ?? null,
      deployMode: opts.deployMode ?? DEFAULT_DEPLOY_MODE,
      ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
    });
  }

  async fingerprint(): Promise<FlowSourceFingerprint> {
    const { flows, rev } = await this.client.getFlows();
    return { sha256: canonicalHash(flows), rev };
  }

  describe(): FlowSourceDescriptor {
    return { kind: 'adminapi', target: this.client.baseUrl };
  }

  /**
   * For admin-api sources, the runtime owns the file path. Project-mode
   * detection happens via `GET /diagnostics` (`runtime.projects.enabled`,
   * `runtime.flowFile`). We cap the cost: if /diagnostics is unavailable,
   * we surface that as an INFO-level warning rather than throwing.
   */
  async inspectWarnings(): Promise<readonly FlowSourceWarning[]> {
    const warnings: FlowSourceWarning[] = [];
    let diag: Record<string, unknown> | undefined;
    try {
      diag = await this.client.getDiagnostics();
    } catch {
      // /diagnostics may be administratively disabled (FeatureDisabledError).
      // That's fine — we just can't surface the warning here.
      return warnings;
    }
    const runtime = (diag['runtime'] as Record<string, unknown> | undefined) ?? undefined;
    const projects = runtime?.['projects'] as Record<string, unknown> | undefined;
    if (projects && projects['enabled'] === true) {
      const activeProject =
        typeof projects['activeProject'] === 'string' ? projects['activeProject'] : undefined;
      const flowFile = typeof runtime?.['flowFile'] === 'string' ? runtime['flowFile'] : undefined;
      warnings.push({
        code: 'project-mode-active',
        message:
          `Node-RED is running in projects mode${activeProject !== undefined ? ` (active: ${activeProject})` : ''}. ` +
          `The runtime flowFile is ${flowFile ?? '<unknown>'}. Tools that read flows via the Admin API are unaffected, ` +
          'but any external snapshot/staging path that assumes <userDir>/flows.json will be wrong.',
      });
    }
    return warnings;
  }
}
