/**
 * Base error class for all policy-related errors.
 */
export class PolicyError extends Error {
  /**
   * The name of the policy that threw this error.
   */
  readonly policyName: string;

  constructor(message: string, policyName: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PolicyError';
    this.policyName = policyName;

    // Maintains proper stack trace for where error was thrown (V8 only)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- V8 only
    Error.captureStackTrace?.(this, PolicyError);
  }
}
