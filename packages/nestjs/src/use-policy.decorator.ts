import { SetMetadata } from '@nestjs/common';

export const POLLY_POLICY_KEY = 'POLLY_POLICY';

/**
 * Decorator to apply a Polly policy to a method or class.
 * @param policyName The name of the registered policy to use.
 */
export const UsePolicy = (policyName: string): ReturnType<typeof SetMetadata> =>
  SetMetadata(POLLY_POLICY_KEY, policyName);
