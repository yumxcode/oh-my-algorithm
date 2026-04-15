# Sim2Real Checklist
_Algorithm: {design_id} | Hardware: {robot_name} | Policy: {policy_file}_
_Created: {date} | OMA Stage: deploy_

关联资料:
- 部署基线: [deploy_info.json](../deploy_info.json)
- RL 配置: [{control_config_path}]({control_config_path})
- 控制器: [{controller_source_path}]({controller_source_path})

---

## 文档结构

| 文件类型 | 位置 | 用途 |
|---|---|---|
| 本文件 | deploy/sim2real_checklist.md | 总览、轮次索引、当前结论 |
| 具体实验方案 | deploy/sim2real/plans/ | 每个阶段/问题的测试计划 |
| 每轮结果 | deploy/sim2real/results/ | 每次真机实验的记录 |
| 部署契约 | deploy/deploy_info.json | 完整参数和 sim2real 指南 |

---

## 当前状态

| 项目 | 当前值 |
|---|---|
| OMA 阶段 | `deploy` |
| 当前 sim2real 轮次 | `Round 1` |
| 当前轮状态 | `not started` |
| 当前重点 | `sensor_and_sign_check` |
| 上一轮状态 | — |

---

## 阶段总览

| 阶段 | 状态 | 目标 | 方案 | 最近结果 |
|---|---|---|---|---|
| `sensor_and_sign_check` | `pending` | IMU/关节顺序/符号/零位验证 | 待创建 | 待更新 |
| `stand_transition` | `pending` | 站立稳定（零位→站立→保持） | 待创建 | 待更新 |
| `rl_idle_and_in_place_step` | `pending` | RL 零速/小速度基础行为 | 待创建 | 待更新 |
| `[parameter_identification]` | — | 按需插入（发现问题时创建） | — | — |
| `low_speed_walk` | `pending` | 低速直行稳定性 | 待创建 | 待更新 |
| `lateral_and_yaw` | `pending` | 横移与转向验证 | 待创建 | 待更新 |
| `disturbance_and_contact` | `pending` | 扰动恢复与地面适应 | 待创建 | 待更新 |

状态说明: `pending` / `in progress` / `completed` / `blocked`

---

## 轮次索引

| 轮次 | 日期 | 状态 | 目标 | 结果文件 |
|---|---|---|---|---|
| `Round 1` | {date} | `pending` | — | 待生成 |

---

## 当前结论

_（每完成一轮实验后更新本节）_

- 暂无结论（实验尚未开始）

---

## 参数适配日志

记录所有相对 sim 基线的参数变更。不改策略，只改部署侧参数。

| 参数 | Sim 基线值 | 当前部署值 | 变更原因 | 在哪轮变更 |
|---|---|---|---|---|
| _(空，随实验填入)_ | | | | |

---

## 维护规则

1. **本文件只维护总览**，不写大段实验细节。
2. 新的具体实验方案写到 `deploy/sim2real/plans/`。
3. 每轮真机实验结果写到 `deploy/sim2real/results/round_{NN}_{desc}.md`。
4. 每完成一轮实验，只更新：
   - 当前轮次编号
   - 当前轮状态
   - 阶段总览表（对应阶段状态）
   - 轮次索引表（新增一行）
   - 当前结论（替换为新结论）
   - 参数适配日志（如有参数变更）
5. **辨识优先于调参**：发现问题时，先创建辨识方案，测量完再决定调哪个参数。
6. **一次只改一个变量**：每次参数变更记录理由，避免无法归因。
