import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { IPolicy } from '@polly-ts/core';

/**
 * Metadata key for Polly Context attached to the request.
 */
export const POLLY_CONTEXT = Symbol('POLLY_CONTEXT');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augmentation requires namespace
  namespace Express {
    interface Request {
      [POLLY_CONTEXT]?: unknown;
    }
  }
}

/**
 * Creates an Express middleware that applies a Polly policy to the request.
 * Useful for Circuit Breakers, Bulkheads, and Timeouts.
 *
 * @param policy The policy to apply.
 * @returns Express RequestHandler.
 */
export function polly(policy: IPolicy): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Create a promise that tracks the response lifecycle
    let finishRequest: () => void;
    let failRequest: (reason?: unknown) => void;

    const requestPromise = new Promise<void>((resolve, reject) => {
      finishRequest = resolve;
      failRequest = reject;
    });

    const onFinish = (): void => {
      cleanup();
      // Optionally treat 5xx as failures for Circuit Breaker?
      // For now, let's treat any completed response as success for the *policy* execution (availability),
      // unless status code implies severe system failure.
      // Standard practice: 5xx are failures.
      if (res.statusCode >= 500) {
        failRequest(new Error(`HTTP ${String(res.statusCode)}`));
      } else {
        finishRequest();
      }
    };

    const onClose = (): void => {
      cleanup();
      // Connection closed prematurely usually means failure
      finishRequest(); // Or fail? If closed by client, maybe not a server failure.
    };

    const cleanup = (): void => {
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
    };

    res.on('finish', onFinish);
    res.on('close', onClose);

    policy
      .execute(async (context) => {
        // Attach signal to request for downstream cancellation
        // Attach to req for downstream usage
        // (Express doesn't have standard abort signal on req in older versions, but Node http does have req.destroy)
        // We can expose it via a known property
        (req as Request & { signal?: AbortSignal }).signal = context.signal;

        context.signal.addEventListener('abort', () => {
          // If timeout occurs, we might want to end the response if headers haven't been sent.
          if (!res.headersSent) {
            // Forward error to express error handler?
            // Wait, we are inside policy execution.
            // If we throw here, policy catches it? No, this is an event listener.
          }
        });

        // Proceed to next middleware
        next();

        // Wait for response to finish
        await requestPromise;
      })
      .catch((err: unknown) => {
        // Policy rejected (Circuit Open, Bulkhead Rejected, Timeout)
        // Cleanup listeners if they are still attached (e.g. fast fail)
        cleanup();

        // If headers sent, we can't error gracefully, just destroy
        if (res.headersSent) {
          res.destroy();
          return;
        }

        // Delegate to Express error handler
        next(err);
      });
  };
}
