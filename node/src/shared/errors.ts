/**
 * 需要人工完成登录/安全验证时使用。
 * CLI 模式下会把它映射为 result.status = manual_required。
 */
export class ManualRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualRequiredError";
  }
}

