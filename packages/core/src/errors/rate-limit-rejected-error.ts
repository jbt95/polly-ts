import { PolicyError } from './policy-error';

export class RateLimitRejectedError extends PolicyError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 'RateLimiterPolicy');
    this.name = 'RateLimitRejectedError';
  }
}
