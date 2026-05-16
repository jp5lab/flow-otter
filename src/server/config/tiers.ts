import type { Config } from './schema.js';

export type ToolTier = 'read' | 'author' | 'validate' | 'stage' | 'deploy' | 'dangerous';

export function isTierEnabled(tier: ToolTier, config: Config): boolean {
  switch (tier) {
    case 'read':
      return true;
    case 'validate':
      return true;
    case 'stage':
    case 'author':
      return config.ENABLE_WRITE_TOOLS && !config.READ_ONLY_MODE;
    case 'deploy':
      return (
        config.ENABLE_WRITE_TOOLS &&
        config.ENABLE_DEPLOY_TOOLS &&
        !config.READ_ONLY_MODE &&
        !config.DRY_RUN_MODE
      );
    case 'dangerous':
      return (
        config.ENABLE_WRITE_TOOLS &&
        config.ENABLE_DEPLOY_TOOLS &&
        config.ENABLE_DANGEROUS_TOOLS &&
        !config.READ_ONLY_MODE &&
        !config.DRY_RUN_MODE
      );
  }
}
