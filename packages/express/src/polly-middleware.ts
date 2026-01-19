import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { IPolicy } from 'polly-ts-core';

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
    let finishRequest: () => void;
    let failRequest: (reason?: unknown) => void;

    const requestPromise = new Promise<void>((resolve, reject) => {
      finishRequest = resolve;
      failRequest = reject;
    });

    const onFinish = (): void => {
      cleanup();
      if (res.statusCode >= 500) {
        failRequest(new Error(`HTTP ${String(res.statusCode)}`));
      } else {
        finishRequest();
      }
    };

    const onClose = (): void => {
      cleanup();
      finishRequest();
    };

    const cleanup = (): void => {
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
    };

    res.on('finish', onFinish);
    res.on('close', onClose);

    policy
      .execute(async (context) => {
        (req as Request & { signal?: AbortSignal }).signal = context.signal;
        context.signal.addEventListener('abort', () => {
          if (!res.headersSent) {
            res.status(503).send('Service Unavailable');
          }
        });
        next();
        await requestPromise;
      })
      .catch((err: unknown) => {
        cleanup();
        if (res.headersSent) {
          res.destroy();
          return;
        }
        next(err);
      });
  };
}
