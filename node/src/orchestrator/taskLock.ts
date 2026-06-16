const locks = new Map<string, Promise<void>>();

export async function withTaskLock<T>(taskId: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(taskId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(taskId, queued);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(taskId) === queued) locks.delete(taskId);
  }
}
