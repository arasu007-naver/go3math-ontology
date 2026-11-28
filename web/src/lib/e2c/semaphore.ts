export class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;
  private max: number;
  constructor(max: number) {
    this.max = Math.max(1, max);
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
