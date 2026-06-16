# slack_protocol.md

## 1. 适用范围
适用于 Step 4（管理者选择）与可选发布前抽检。

## 2. 消息模板（选择）
必须包含：
- `task_id` `run_id`
- 候选列表（编号、标题、来源、评分）
- 回复指令示例

示例指令：`pick 2,5,8`

## 3. 输入语法
- 语法：`pick <n>(,<n>)*`
- `n` 为 1-based 正整数
- 超出范围或格式错误时返回可读错误并要求重输

## 4. 记录规则
Step 4 的审批事件记录到：
- `task.json.steps.approval`
字段至少含：`message_ts`、`raw_input`、`parsed_selection`、`operator`、`at`

Step 5 才会生成正式产物：
- `selected_topics_YYYYMMDD[_runid].json`

## 5. 超时与提醒
- T+X：第一次提醒
- T+Y：第二次提醒
- 超时：`task.status=approval_timeout`

## 6. 权限与安全
- 仅白名单管理者可执行 `pick`
- 非白名单输入记录为审计事件，不触发状态推进
