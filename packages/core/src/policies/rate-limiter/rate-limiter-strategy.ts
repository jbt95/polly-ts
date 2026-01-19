export interface IRateLimiterStrategy {
  /**
   * Attempts to acquire a permit.
   * @returns true if permit acquired, false otherwise.
   */
  acquire(): Promise<boolean> | boolean;

  /**
   * Returns when a permit is available.
   * @param timeoutMs Max time to wait.
   * @returns true if acquired, false if timeout.
   */
  waitForPermit(timeoutMs?: number): Promise<boolean>;
}
