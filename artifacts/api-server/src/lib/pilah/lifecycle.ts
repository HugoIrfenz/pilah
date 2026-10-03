let generation = 0;
let erasing = false;
let queue: Promise<unknown> = Promise.resolve();
export function currentGeneration(): number { return generation; }
export function invalidateWork(): number { generation += 1; return generation; }
export function isErasing(): boolean { return erasing; }
export function beginErasure(): void { erasing = true; invalidateWork(); }
export function endErasure(): void { erasing = false; }
export function serialWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}
export function guardedWrite<T>(epoch: number, work: () => Promise<T>): Promise<T | undefined> {
  return serialWrite(async () => epoch === generation ? work() : undefined);
}