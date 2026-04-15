# oh-my-algorithm (OMA)

> 机器人强化学习算法开发的全流程编排层 · A Codex-native orchestration layer for robot RL algorithm development

[![Node.js](https://img.shields.io/badge/runtime-Node.js-green)](https://nodejs.org)
[![Codex](https://img.shields.io/badge/powered%20by-Codex%20CLI-blue)](https://github.com/openai/codex)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

---

## 什么是 OMA？

**oh-my-algorithm (OMA)** 是一个构建在 [Codex CLI](https://github.com/openai/codex) 之上的机器人算法开发工作流编排层。它将机器人强化学习开发的完整生命周期（需求 → 设计 → 实现 → 训练 → 调优 → 部署）拆分为独立的、上下文感知的 Codex skill，并通过门控状态机管理流程推进。

OMA 不是框架，不是库。它是一套**开发工作流协议**：用结构化的阶段状态文件、技术文档模板和 skill 提示词，让 Codex 在每个阶段都能做出高质量、领域正确的决策。

### 核心特性

- **门控生命周期**：六个标准开发阶段，前置条件检查确保不跳步骤
- **单阶段直入**：`oma go <stage>` 绕过门控直接进入任意阶段
- **全局经验库**：`oma xp` 跨项目积累 design/tune/deploy 经验，Codex 按需查阅
- **机器人 RL 优先**：控制频率、自由度、Sim2Real gap、奖励函数设计是一等公民
- **Gradmotion 原生集成**：gm CLI、Isaac GYM 镜像、A10 GPU 任务创建规范内置
- **零外部依赖**：CLI 仅使用 Node.js 内置模块
- **Sim2Real 部署验证**：8 类测试模板（延迟/电机/噪声/稳定性/步态/速度/扰动/地形）

---

## 安装

```bash
# 克隆仓库
git clone https://github.com/yumxcode/oh-my-algorithm.git
cd oh-my-algorithm

# 全局安装（无需 npm install，零依赖）
npm install -g .

# 验证安装
oma --help
```

安装后 `oma` 命令全局可用。

---

## 快速开始

### 1. 初始化项目

```bash
# 在你的机器人算法项目目录下
mkdir my-robot-algo && cd my-robot-algo
oma setup
```

`oma setup` 会创建 `.oma/` 目录结构并引导你完成初始配置。

### 2. 启动 Codex 并开始需求阶段

```bash
codex
# Codex 读取 AGENTS.md，自动识别项目阶段，进入 requirement skill
```

### 3. 按阶段推进（门控模式）

完成每个阶段后，Codex skill 会输出结构化文档到 `.oma/` 目录，通过门控条件后自动解锁下一阶段：

```
requirement → design → implement → train → tune → deploy
```

### 4. 单阶段直入（绕过门控）

```bash
# 直接进入训练阶段，无需完整前置
oma go train --reason "已有参考实现，直接开始训练调试"

# 查看当前 standalone 状态
oma go status

# 退出 standalone 模式，恢复门控
oma go off
```

---

## CLI 命令参考

### `oma setup`

初始化 OMA 项目结构。

```bash
oma setup
```

在当前目录创建：
- `.oma/` — 项目状态目录
- `AGENTS.md` — Codex 主提示词（如不存在则从模板生成）

---

### `oma go <stage>`

**单阶段直入**：不经过门控，直接进入指定阶段。Codex 启动后读取 `.oma/standalone.json`，自动切换为 advisory（建议性）门控模式。

```bash
oma go requirement          # 进入需求阶段
oma go design               # 进入设计阶段
oma go implement            # 进入实现阶段
oma go train                # 进入训练阶段
oma go tune                 # 进入调优阶段
oma go deploy               # 进入部署阶段
oma go consolidate          # 进入汇总阶段

oma go train --reason "从已有 checkpoint 继续"  # 附加原因
oma go status               # 查看当前 standalone 状态
oma go off                  # 关闭 standalone，恢复门控
```

有效阶段：`requirement` `design` `implement` `train` `tune` `deploy` `consolidate`

---

### `oma xp` — 全局经验库

跨项目积累 design / tune / deploy 三个阶段的成功经验，存储于 `~/.oma/experiences.jsonl`。

进入这三个阶段时，Codex 会被告知经验库的存在，并自行决定是否查阅。

```bash
# 添加经验（交互式，在 Codex 内或终端均可运行）
oma xp add --stage design

# 搜索（Codex 按需调用，也可手动查询）
oma xp search "reward hacking"
oma xp search "biped latency" --stage deploy

# 列出 / 查看 / 删除
oma xp list --stage tune
oma xp show design-001
oma xp delete tune-003
```

**经验条目字段**：`id` / `stage` / `robot_type` / `task` / `title` / `context` / `insight` / `outcome` / `tags` / `source_project`

**质量原则**：只存已验证的成功路径；outcome 优先量化；tags 必填机器人类型和任务类型。

---

### `oma doctor`

检查项目健康状态：阶段文件完整性、门控条件、上下文可用性。

```bash
oma doctor
```

示例输出：
```
✓ .oma directory exists
✓ config.json found
⚠ Standalone mode: ACTIVE (stage=train, entered 2h ago)
✗ design.md missing — train gate requires design document
  Hint: Or run `oma go train` to enter directly (bypass gate)
```

---

### `oma status`

显示当前项目状态概览。

```bash
oma status
```

---

### `oma log`

查看阶段推进历史记录。

```bash
oma log
oma log --stage train       # 过滤特定阶段
```

---

### `oma extract`

从 Codex 对话中提取结构化输出并写入 `.oma/` 状态文件。

```bash
oma extract
```

---

### `oma index --src <path>`

注册开源参考代码库，供 implement 阶段的 Path A（改造现有代码）使用。

```bash
oma index --src ~/code/legged_gym
oma index --src https://github.com/leggedrobotics/rsl_rl   # Git 地址自动 clone
```

注册后生成 `.oma/config.json`，implement skill 自动检测并提示选择 Path A。

---

### `oma search <query>`

在已注册的代码库中搜索相关实现。

```bash
oma search "reward function"
oma search "observation space"
```

---

## 开发生命周期详解

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  requirement │───▶│    design    │───▶│  implement   │
│              │    │              │    │              │
│ 机器人平台参数│    │ 网络/奖励/DR │    │ Path A/B选择 │
│ 任务/环境定义│    │ 完整RL规格   │    │ 开源参考询问 │
└──────────────┘    └──────────────┘    └──────────────┘
                                                │
                                                ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    deploy    │◀───│     tune     │◀───│    train     │
│              │    │              │    │              │
│ Sim2Real测试 │    │ 超参调优     │    │ gm任务创建   │
│ 8类验证模板  │    │ 消融实验     │    │ 失效模式分类 │
└──────────────┘    └──────────────┘    └──────────────┘
```

### Requirement — 需求阶段

Skill 引导完成：
- 任务描述（locomotion / manipulation / navigation）
- 机器人平台参数（必填）：`robot_model`、`DoF`、`sim_env`、`control_hz`、`obs_dim`、`action_dim`
- Domain Randomization 风险点识别
- 约束条件与成功指标

**门控输出**：`.oma/requirement.md`

---

### Design — 设计阶段

Skill 生成完整的 RL 算法规格：

- **策略网络**：架构类型、输入维度、输出维度（= DoF）、激活函数、动作缩放
- **价值网络**：独立规格
- **奖励函数**：每个奖励项必须包含公式 + 系数 + 目的 + 奖励黑洞风险
- **观测空间**：标准本体感知模板（关节位置/速度、IMU、速度指令、上一步动作）
- **动作空间**：PD 控制 Kp/Kd 规格
- **Domain Randomization**：Kp/Kd/质量/摩擦/延迟/噪声参数范围表
- **训练课程**：阶段划分与切换条件
- **RL 算法**：PPO/SAC 具体超参（clip_range、tau 等）
- **消融实验计划**：最少 5 个变量

**门控输出**：`.oma/design.md`

---

### Implement — 实现阶段

**Phase 0（必须执行）**：Skill 首先询问：

> "实现阶段开始。请问你是否有可以参考或复用的开源代码库？"
> - **有** → Path A：在其基础上改造（使用 `oma index --src <path>` 注册）
> - **没有** → Path B：按设计文档从零实现

| 用户回答 | 路径 | 操作 |
|---------|------|------|
| 提供本地路径 | Path A | 若 config.json 不存在，提示执行 `oma index` |
| 提供 Git 地址 | Path A | 先 clone 再 index |
| config.json 已存在 | Path A | 告知使用已注册路径 |
| 明确说"没有" | Path B | 即使 config.json 存在也走 Path B |

**门控输出**：`.oma/implement.md`、代码文件

---

### Train — 训练阶段（Gradmotion 集成）

Skill 内置 Gradmotion (gm) 平台操作规范：

**训练任务配置**（`create-train.json`）：
```json
{
  "taskName": "your-task-name",
  "image": "registry.cn-hangzhou.aliyuncs.com/...:isaac-gym-preview-4",
  "goodsId": "<A10-GPU-goodsId>",
  "startScript": "gm-run your_project/scripts/train.py --task=your_task --headless --max_iterations=500",
  "codeType": 2,
  "repoUrl": "https://github.com/your-org/your-repo.git"
}
```

**关键规范**：
- 镜像：固定使用 **Isaac GYM preview-4** 官方镜像
- 算力：`goodsName == "1*A10*24G"` 的 goodsId
- 执行命令：`gm-run`（平台专用，相当于 python）**不需要** cd 到项目目录
- 创建方式：始终 `gm task create --file ./create-train.json`

**RL 失效模式分类与处置**：

| 失效模式 | 症状 | 处置方向 |
|---------|------|---------|
| `nan_explosion` | loss/reward 出现 NaN | 观测归一化 → 奖励缩放 → 动作缩放 → 梯度裁剪 → 物理 dt |
| `reward_hacking` | reward 高但行为异常 | 打印轨迹找漏洞 → 修奖励设计（不是学习率问题）|
| `exploration_collapse` | entropy 迅速降到零 | 熵系数 → 初始 std → reset 随机化 → 课程设置 |
| `no_learning` | reward 始终接近零 | 验证奖励非零 → obs 含速度指令 → episode 长度 → 动作裁剪 |

**门控输出**：`.oma/train.md`、checkpoint 路径、训练曲线

---

### Tune — 调优阶段

超参数调优与消融实验：
- 基于 design.md 中的消融计划执行
- 每次实验记录超参变化 + 结果
- 识别关键敏感超参

**门控输出**：`.oma/tune.md`

---

### Deploy — 部署阶段（Sim2Real）

内置 8 类 Sim2Real 验证测试，每类包含 `measure.py` + `analyze.py`：

| # | 类别 | 核心指标 |
|---|------|---------|
| 01 | 延迟特性 | 推理延迟 p50/p95/p99，sim gap 分析 |
| 02 | 电机特性 | 阶跃响应，Kp/Kd 偏差（曲线拟合）|
| 03 | 传感器噪声 | IMU/编码器静止噪声 std vs sim 设定 |
| 04 | 稳定性 | 静态站立、扰动恢复，跌倒率 |
| 05 | 步态质量 | 步频、占空比、对称性 CV |
| 06 | 速度跟踪 | 跟踪误差、振荡频率、最大稳定速度 |
| 07 | 扰动鲁棒性 | 侧推/正推/载荷/坡道，按类型跌倒率 |
| 08 | 地形适应 | 平地/坡面/台阶/非结构地形通过率 |

测试模板位于 `templates/deploy-tests/`，配置参考 `templates/deploy-config.json`。

---

## 项目文件结构

```
your-robot-project/
├── .oma/                      # OMA 状态目录（由 oma setup 创建）
│   ├── config.json            # 项目配置（robot platform, skill paths）
│   ├── requirement.md         # 需求文档（requirement skill 输出）
│   ├── design.md              # 设计规格（design skill 输出）
│   ├── implement.md           # 实现记录（implement skill 输出）
│   ├── train.md               # 训练记录（train skill 输出）
│   ├── tune.md                # 调优记录（tune skill 输出）
│   ├── deploy.md              # 部署记录（deploy skill 输出）
│   ├── standalone.json        # Standalone 模式状态（oma go 写入）
│   └── log.jsonl              # 阶段推进历史
│
├── AGENTS.md                  # Codex 主提示词（OMA 核心）
└── [你的代码文件]

~/.oma/
└── experiences.jsonl          # 全局经验库（跨项目共享，oma xp 管理）
```

---

## Standalone 模式

门控系统确保流程质量，但有时你需要直接进入某个阶段（例如快速调试训练、基于已有设计继续）。Standalone 模式提供无门控的单阶段入口：

```bash
# 进入 train 阶段（不检查前置文件）
oma go train --reason "已有 checkpoint，继续 finetune"

# 此时 .oma/standalone.json 被创建
# Codex 读取 AGENTS.md 时检测到该文件，切换为 advisory 门控
# 所有门控条件变为"建议"而非"阻止"

# 退出 standalone
oma go off
```

`.oma/standalone.json` 内容：
```json
{
  "stage": "train",
  "skill": "train",
  "enteredAt": "2025-01-15T10:30:00.000Z",
  "reason": "已有 checkpoint，继续 finetune"
}
```

---

## 关于 AGENTS.md

`AGENTS.md` 是 OMA 的核心。Codex CLI 每次启动时读取它，内容包括：

- **启动协议**：检查 standalone 状态、读取当前阶段、加载上下文
- **阶段门控规则**：每个阶段的前置文件要求
- **机器人 RL 操作原则**：
  - Sim2Real gap 是部署的首要风险
  - 奖励黑洞是行为崩塌的根因
  - 控制频率 (`control_hz`) 决定推理延迟预算
  - 所有设计决策必须有 Sim2Real 理由
- **关键词检测**：识别 PPO/SAC/sim2real/reward/gm/gradmotion 相关上下文
- **平台规范**：Gradmotion gm CLI 操作规范

---

## Gradmotion 快速参考

```bash
# 查询可用算力（找 A10）
gm goods list

# 查询可用镜像（找 isaac-gym-preview-4）
gm image official list
gm image versions --image <image-id>

# 创建训练任务
gm task create --file ./create-train.json

# 查看任务状态
gm task list
gm task log --task <task-id>

# 删除任务
gm task delete --task <task-id>
```

---

## 设计哲学

**为什么不用 Python？**
OMA CLI 使用纯 Node.js 内置模块（fs、path、readline），零 npm 依赖，`npm install -g .` 即可全局使用，无需虚拟环境、无版本冲突。

**为什么基于 Codex 而不是自建 Agent？**
Codex CLI 已经解决了工具调用、代码执行、文件编辑的基础设施问题。OMA 只需要提供高质量的领域知识（AGENTS.md + skill prompts），让 Codex 在正确的上下文中做出正确决策。

**为什么每个阶段要写文件？**
`.oma/*.md` 文件是跨 Codex 会话的状态记忆。Codex 无法记住上次对话，但可以读取文件。OMA 把"记忆"外化为结构化文档，让每次 Codex 会话都有完整上下文。

**为什么经验库是全局的？**
`~/.oma/experiences.jsonl` 跨项目积累，不绑定单个仓库。在二足机器人项目 A 里发现的奖励函数技巧，在四足项目 B 里同样可以参考。越用越有价值。

---

## 贡献

欢迎 PR 和 Issue。主要贡献方向：

- 新的 deploy 测试类别
- 更多机器人平台的 skill 适配（手臂/无人机/轮式）
- oma CLI 新命令
- AGENTS.md / skill 提示词优化

---

## License

MIT © 2025 oh-my-algorithm contributors
