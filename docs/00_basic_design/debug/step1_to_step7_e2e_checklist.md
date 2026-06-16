# Publish-Orchestrator 调试路线文档（Step1~Step7）v1

## 1. 目标与原则

### 1.1 目标

1. 打通 Step1~Step7 自动推进闭环。
2. 以 `task.json` 作为状态真相（SSOT）。
3. 用 SQLite outbox + dispatcher 驱动事件。
4. 在调试过程中补齐缺失角色、代码与规则。
5. 每阶段都可回归、可审计、可恢复。

### 1.2 执行原则

- 先骨架，后能力。
- 先最小可用，后真实接入。
- 一次只收敛一个边界。
- 文档与 checklist 同步更新。
- 所有状态变更必须通过 `updateTask()`。

## 2. 架构边界（必须遵守）

1. `task.json` 是 SSOT。
2. `outbox_events` 不是状态真相，只是通知层。
3. `updateTask()` 是唯一状态写入口。
4. `dispatcher` 是唯一事件消费推进器。
5. Executor 不得直接推进 `task.status`。
6. dispatcher 不信 payload 状态，处理前必须重读 `task.json`。
7. 事件丢失/重复必须可通过 `task.json + revision + reconcile` 修复。

## 3. 目录与组件清单（建议）

- `src/orchestrator/updateTask.ts`
- `src/orchestrator/dispatcher.ts`
- `src/orchestrator/decideNextAction.ts`
- `src/orchestrator/reconcile.ts`
- `src/orchestrator/outboxRepo.ts`
- `src/executors/step2Collect.ts`（先真实）
- `src/executors/stepTidyFromCollect.ts`（首轮候选整理：collect_result → topic_candidates.v1）
- `src/executors/step4Approval.ts`（先本地审批入口）
- `src/executors/step5Finalize.ts`
- `src/executors/step6Generate.ts`（先最小）
- `src/executors/step7Publish.ts`（先 dry-run/mock）

## 4. 分阶段调试路线

### 阶段 A：最小 Orchestrator 骨架

完成项：

- [-] SQLite `outbox_events` 表与索引
- [-] `updateTask()`
- [-] `dispatcher` 消费循环
- [-] `decideNextAction()`（先覆盖 Step1~Step3）
- [-] `reconcile` 启动补偿

验收：

- [] `updateTask()` 写入后产生 `TASK_UPDATED`
- [] dispatcher 能消费 pending 事件
- [] `revision` 单调递增
- [] 重启后 reconcile 能补触发卡住任务

冻结点：

- 建议 tag：`orchestrator-mvp-core`
- 保存样例任务目录：核心骨架成功样例 1 份、恢复/补偿样例 1 份
- 记录已验证状态迁移矩阵

### 阶段 B：Step1→Step2 真实接入（首条真实链路）

完成项：

- [-] Step1 创建 task + 目录 + 初始状态
- [-] 接入现有 Node Step2 采集 executor
- [-] Step2 返回 `steps.collect.*`，由 Orchestrator 经 `updateTask()` 写入
- [-] dispatcher 按结果推进

重点验证：

- [ ] `collecting -> collected`（success）
- [ ] `collecting + partial_failed -> collected`（且 `degraded=true`，随后进入 Tidy）
- [ ] `failed/init_failed` 不进入 Step3
- [ ] outbox 事件全链路可追踪

冻结点：

- 建议 tag：`step2-real-flow-ok`
- 保存样例任务目录：采集成功 1 份、采集失败或 partial 1 份
- 记录 `collect` 相关状态迁移矩阵

### 阶段 C：Step3 Tidy + Step4（Slack / 本地 pick）

#### C1. Step3 候选整理（无 LLM）

- [ ] `executeTidyFromCollect` 能读取 `collect_result` 并校验 `task_id`/`run_id`
- [ ] 产出 `tidy/topic_candidates_<JSTYYYYMMDD>_<runId>.json`，`schema_version=topic_candidates.v1`
- [ ] `items[]` 含递增 `index`（1-based）、`topic_id`、`title`、`source_platform`、`source_url`
- [ ] Orchestrator 经 `updateTask()` 回写 `steps.tidy.status=success|failed` 与 `output_ref`
- [ ] 成功链路：`collected` 下 `steps.tidy` 成功；`task.status` 保持 `collected` 直至 Step4
- [ ] 失败链路：`TIDY_*` 错误写入 `steps.tidy.error`
- [ ] 遗留 `clean_result` 仅作 Step4 读档兼容，不作为新任务主路径

#### C2. Step4 审批角色（先本地入口）

- [ ] 本地审批命令/API（模拟 pick）
- [ ] 审批事件写 `steps.approval`
- [ ] 超时机制（提醒/超时）
- [ ] 后续切 Slack 实现

#### C2.5. Step4 选题落盘（`submit-pick` / `materialize-collect`）

- [ ] `submit-pick` 能产出合规 **`selected_topics`** 与 **`selected_collect_items`**
- [ ] `steps.approve.output_ref` / **`collect_items_ref`** 写回正确
- [ ] 能返回 `steps.approve.status=success`
- [ ] Orchestrator 能推进 `task.status=manager_selected`

#### C2.6. Step5 二次采集（最小，编排接入后）

- [ ] `deep_collect_result` 占位或合规
- [ ] `task.status`：`manager_selected` → `deep_collecting` → `deep_collected`

#### C3. Step6 生成角色（最小）

- [ ] deep_collect_result 占位可用
- [ ] copy_result 合规
- [ ] image_result 合规

#### C4. Step7 发布角色

- [ ] 先 dry-run/mock（不真实发帖）
- [ ] 验证 `publish_result` 与终态
- [ ] 再切真实平台发布

冻结点：

- Step3 Tidy + Step4 建议 tag：`tidy-approval-mvp-ok`
- Step6 + Step7 建议 tag：`gen-publish-mvp-ok`
- 每个缺失角色保存成功/失败样例任务目录各 1 份
- 每个角色补齐后更新该 step 的验收用例与状态迁移矩阵

### 阶段 D：全链路联调与故障注入

主链路：

- [ ] Step1~Step7 自动完成
- [ ] `published` 终态正确

异常链路：

- [ ] Step2 partial_failed 降级
- [ ] Step4 approval_timeout
- [ ] Step7 部分失败 -> `publish_partial_failed`
- [ ] 事件重复不产生重复副作用

冻结点：

- 建议 tag：`end-to-end-v1-ok`
- 保存完整成功链路任务目录 1 份
- 保存关键失败链路任务目录：approval_timeout、publish_partial_failed、Step2 partial_failed
- 记录最终状态迁移矩阵与失败注入结果

## 5. 每步统一调试检查项（固定 Checklist）

每次执行 step 后都检查：

1. `steps.<step>.status` 是否正确。
2. `task.status` 是否仅由 orchestrator 推进。
3. `updated_at` 是否刷新（JST）。
4. `revision` 是否 +1。
5. `output_ref` 是否存在且可读。
6. artifact 是否符合 schema。
7. outbox 是否新增事件。
8. dispatcher 是否记录消费成功、重试或失败。

## 6. 角色补齐策略

### 6.1 补齐顺序

1. 先补“能产出合规 artifact”的最小角色。
2. 再补业务质量（模型策略、风格、风险）。
3. 再补平台细节与优化。

### 6.2 角色规则模板（统一句式）

> Executor 只负责执行本步骤、产出 artifact、返回 `steps.<step>` 结果；不得直接推进 `task.status`。对 `task.json` 的实际回写与主状态推进必须由 Orchestrator 通过 `updateTask()` 完成，并生成 outbox 事件。

### 6.3 每补一个角色必须做

- [ ] 增加/更新角色规则文档
- [ ] 增加该 step 的验收用例（成功+失败）
- [ ] 补充 `decideNextAction` 映射
- [ ] 更新总 checklist

## 7. 事件与恢复策略（运行保障）

1. 事件状态：`pending -> processing -> done/failed`
2. 重试退避：1s / 3s / 10s（可配置）
3. 陈旧事件规则：`event.revision < task.revision` 直接 done
4. `outbox_events` 不是状态真相，不得用 outbox 反推任务状态；恢复与决策必须重读 `task.json`
5. 服务启动必须执行 reconcile：
   - 回收超时 processing 事件
   - 扫非终态 task，缺事件则补 `TASK_RECONCILE`

## 8. 调试节奏建议（每日）

### Day 1

- 完成骨架（A 阶段）
- 建议 tag：`orchestrator-mvp-core`

### Day 2

- 打通 Step1→Step2 真实链路（B 阶段）
- 建议 tag：`step2-real-flow-ok`

### Day 3

- 补 Step3 Tidy + Step4 本地审批（C1/C2）
- 建议 tag：`tidy-approval-mvp-ok`

### Day 4

- 补 Step6 最小生成 + Step7 mock
- 建议 tag：`gen-publish-mvp-ok`

### Day 5

- 全链路 + 故障注入 + 文档收敛（D 阶段）
- 建议 tag：`end-to-end-v1-ok`

## 9. 完成定义（DoD）

满足以下全部即完成本轮调试：

- [ ] Step1~Step7 自动推进无人工触发下一步
- [ ] 所有状态变更均经 `updateTask()`
- [ ] outbox/dispatcher/reconcile 可稳定恢复
- [ ] 审批超时链路可验证
- [ ] `published` 与 `publish_partial_failed` 均可稳定产出
- [ ] 缺失角色已补最小可用版并写明规则
- [ ] 文档与实现一致，无“代码先行、文档滞后”
