export class SyncSchedule {
  failures = 0;
  nextAttempt = 0;
  ready(now = Date.now()) {
    return now >= this.nextAttempt;
  }
  success(now = Date.now()) {
    this.failures = 0;
    this.nextAttempt = now + 5 * 60000;
  }
  failed(now = Date.now()) {
    this.failures++;
    this.nextAttempt = now + Math.min(15, 2 ** this.failures) * 60000;
    return this.failures === 1;
  }
}
