export class NodeRedError extends Error {
  public override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NodeRedError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export class AuthFailedError extends NodeRedError {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthFailedError';
  }
}

/**
 * 403 with a `<feature>.disabled` body code — the request is well-formed and
 * authenticated, but the feature is administratively turned off (e.g.
 * `diagnostics.disabled` when `runtimeState.diagnostics: false`). Distinct from
 * a permission/auth denial so callers can present "feature off" vs "wrong
 * token" without conflating them.
 */
export class FeatureDisabledError extends NodeRedError {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FeatureDisabledError';
  }
}

export class RevMismatchError extends NodeRedError {
  constructor(
    public readonly expectedRev: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'RevMismatchError';
  }
}

export class NodeRedDownError extends NodeRedError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'NodeRedDownError';
  }
}

export class NodeRedHttpError extends NodeRedError {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'NodeRedHttpError';
  }
}

export class DriftError extends Error {
  constructor(
    public readonly expectedHash: string,
    public readonly actualHash: string,
    message: string,
  ) {
    super(message);
    this.name = 'DriftError';
  }
}
