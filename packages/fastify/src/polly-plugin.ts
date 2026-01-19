import type { FastifyRequest, FastifyReply } from 'fastify';
import type { IPolicy } from '@polly-ts/core';

/**
 * Creates a Fastify hook handler that applies a Polly policy.
 * Usage: fastify.addHook('onRequest', polly(policy));
 *
 * @param policy The policy to apply (CircuitBreaker, Bulkhead, etc.)
 * @returns A Fastify hook handler.
 */
export function polly(policy: IPolicy): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    let gateResolve: () => void;
    let gateReject: (reason?: unknown) => void;
    let gateOpened = false;

    // Promise that blocks the hook until policy permits execution
    const gatePromise = new Promise<void>((resolve, reject) => {
      gateResolve = (): void => {
        if (!gateOpened) {
          gateOpened = true;
          resolve();
        }
      };
      gateReject = (reason): void => {
        if (!gateOpened) {
          gateOpened = true;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        }
      };
    });

    // Promise that tracks response completion for the policy
    const waitForResponse = new Promise<void>((resolve, reject) => {
      const onFinish = (): void => {
        cleanup();
        if (reply.raw.statusCode >= 500) {
          // Rejecting this promise causes the policy checks to fail
          reject(new Error(`HTTP ${String(reply.raw.statusCode)}`));
        } else {
          resolve();
        }
      };

      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      const onClose = (): void => {
        cleanup();
        // If closed prematurely, usually a failure
        resolve(); // or reject depending on semantics
      };

      const cleanup = (): void => {
        reply.raw.removeListener('finish', onFinish);
        reply.raw.removeListener('error', onError);
        reply.raw.removeListener('close', onClose);
      };

      reply.raw.on('finish', onFinish);
      reply.raw.on('error', onError);
      reply.raw.on('close', onClose);
    });

    // Make sure we catch rejection if it happens before await (unlikely but safe)
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional no-op to suppress unhandled rejection
    waitForResponse.catch(() => {});
    // Wait, if I catch here, verify that await still throws or I need to rethrow?
    // If I attach catch, the chain returns a NEW promise that resolves.
    // So 'waitForResponse' variable holds the ORIGINAL promise?
    // Yes, catch() returns a NEW promise. `waitForResponse` is the original.
    // So `await waitForResponse` will still throw!
    // And simple attachment of .catch() suppresses the "Unhandled Rejection" global event?
    // Yes, usually.

    // Execute policy
    const executionPromise = policy.execute(async (context) => {
      (request.raw as FastifyRequest['raw'] & { signal?: AbortSignal }).signal = context.signal;

      gateResolve();

      await waitForResponse;
    });

    executionPromise.catch((err: unknown) => {
      // If gate indicates we haven't started, we must stop fastify
      if (!gateOpened) {
        gateReject(err);
      }
      // If gate opened, the Policy has already recorded the error (via await waitForResponse throwing)
      // We don't need to do anything else.
    });

    await gatePromise;
  };
}
