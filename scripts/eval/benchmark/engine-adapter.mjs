/**
 * EVAL-4-skeleton — S6 layout engine adapter seam (fix plan §3 EVAL-4).
 *
 * The scored runner will call exactly this adapter boundary after LAYO-4
 * lands. Until then the only available adapter is an identity placeholder so
 * the benchmark plumbing can be built and tested without importing the
 * current layout toolkit or touching a live engine.
 */

export const identityAdapter = Object.freeze({
  name: 'identity-stub',
  version: 'pre-layo-4',
  async layout(strippedSpec, _opts = {}) {
    return strippedSpec;
  },
});

export function resolveAdapter(name) {
  if (name === identityAdapter.name) return identityAdapter;
  throw new Error(`engine adapter '${name}' not available until LAYO-4 lands`);
}
