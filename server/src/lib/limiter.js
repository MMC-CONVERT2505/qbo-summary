/**
 * Tiny concurrency + spacing limiter. Keeps us inside Intuit's
 * 10-concurrent / 500-per-minute ceiling without pulling in a dependency.
 */
export function createLimiter({ maxConcurrent = 6, minGapMs = 0 } = {}) {
  let active = 0;
  let lastStart = 0;
  const queue = [];

  const pump = () => {
    if (active >= maxConcurrent || queue.length === 0) return;
    const wait = Math.max(0, lastStart + minGapMs - Date.now());
    setTimeout(() => {
      const job = queue.shift();
      if (!job) return;
      active += 1;
      lastStart = Date.now();
      job.run().then(job.resolve, job.reject).finally(() => {
        active -= 1;
        pump();
      });
      pump();
    }, wait);
  };

  return (run) =>
    new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      pump();
    });
}
