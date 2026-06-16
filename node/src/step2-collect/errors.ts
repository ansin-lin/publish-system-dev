export class HttpCollectError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpCollectError";
  }
}

export class CollectorNotImplementedError extends Error {
  constructor(sourceId: string, allowed: string[]) {
    super(`未实现的采集源: ${sourceId}（允许: ${allowed.join(", ")}）`);
    this.name = "CollectorNotImplementedError";
  }
}

export class NonRetryableCollectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableCollectError";
  }
}

export function isNonRetryableCollectError(error: unknown): boolean {
  return error instanceof CollectorNotImplementedError || error instanceof NonRetryableCollectError || error instanceof TypeError || error instanceof ReferenceError;
}
