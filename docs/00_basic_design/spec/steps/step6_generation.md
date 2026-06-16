# Step 6 详细设计：文案生成 + 图片生成

> **产品定位**：在 **Step5 二次采集** 完成后，基于 `deep_collect_result`（或等价输入）生成 **可发布的文案** 与 **配图**，分别落盘 `copy_result` 与 `image_result`。  
> **总览**：`../pipeline_steps_overview.md`；深挖见 `step5_deep_collect.md`。

## 1. 输入/输出

- **输入**：`DATA_ROOT/<task_id>/deep_collect/deep_collect_result_YYYYMMDD[_runid].json`（`steps.deep_collect.output_ref`）
- **输出**：
  - `DATA_ROOT/<task_id>/generate/copy_result_YYYYMMDD[_runid].json`
  - `DATA_ROOT/<task_id>/generate/image_result_YYYYMMDD[_runid].json`
- Schema：`../schema_artifacts.md`（`copy_result`、`image_result`）

## 2. 前置条件

- `task.status=deep_collected`（或设计允许的等价状态）
- `steps.deep_collect.status=success`

## 3. 处理流程（目标设计）

1. Orchestrator 通过 `updateTask()` 置 `task.status=generating_copy`、`steps.copy`（或约定子 step）为 `running`。
2. 执行文案生成 → 落盘 `copy_result` → `updateTask()` 成功，`generating_copy` → `copy_generated`。
3. Orchestrator 置 `task.status=generating_image`，执行图片生成 → 落盘 `image_result` → `updateTask()` 成功，`generating_image` → `image_generated`。

## 4. 实现状态（与代码对齐）

- **`dispatcher` 尚未串联 Step6 executor**；状态边已在 `transitionGuard.ts` 预留。

## 5. 状态推进

- 文案：`generating_copy` → `copy_generated`
- 图片：`generating_image` → `image_generated`
- 规则：子步骤只回写 `steps.*`；`task.status` 由 Orchestrator 经 `updateTask()` 推进。

## 6. 失败与重试

- 可重试：模型超时、图片排队失败、瞬时 IO
- 不可重试：输入缺失、内容安全拒绝、schema 不合规

## 7. 幂等

- 文案：`task_id + run_id + deep_collect_result_hash + copy_version`
- 图片：`task_id + run_id + copy_result_hash + image_version`

## 8. 产物校验

- 顶层：`schema_version`、`generated_at`、`task_id`、`run_id`
- 文案：各平台可发布 payload；图片：可访问路径或明确错误

## 9. 观测与审计

- 日志：`LOG_ROOT/generate/step6_<task_id>_<YYYYMMDD_HHMMSS>.log`
- 事件：每子步骤经 `updateTask()` 产生 `TASK_UPDATED`

## 10. 配置项

- `copy.model.version`、`image.model.version`、`generate.retry.backoffMs` 等（实现时落地）
