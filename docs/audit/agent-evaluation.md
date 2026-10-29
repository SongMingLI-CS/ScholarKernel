# Agent 工作流与评测能力

基线：`e129eb65e6bcbf6c2df9696c282613a557b672f1`。依据已完成的源码审阅、离线路由回放和受控执行记录。没有在报告编写阶段重新运行测试，没有真实模型效果数据。

## 1. 十个核心问题的回答

### 1）Agent 是否承担不同任务？

通用节点确实分为文件读取、搜索、审计、推理和同行评审，执行函数不同；所以不仅是几个名字不同的聊天窗口。但同行评审 R1、R2、Chair 的核心差异是 `agent/agent-personas.ts` 的角色提示词（Prompt），共享模型构造和生成接口，没有独立训练、各自知识库或专门工具策略。

`peer-review-runner.ts:355` 真正并行调用两个评审函数；其结果进入 debate 和汇总。可以称为“基于角色提示的多智能体编排（Multi-Agent Orchestration）”，不能称为自主训练多个审稿模型，也不能以结构存在证明优于单 Agent。

### 2）Planner 是否具备合理依赖关系？

`planner.ts:10` 的 WorkflowNode 无 dependsOn，LLM 输出任务数组。`agent-executor.ts:609` 按数组顺序执行；没有依赖校验、拓扑排序、循环检测或通用调度器。固定同行评审组有 `R1∥R2 → debate → Chair` 的程序化依赖，其余主要依赖列表顺序。

JSON 清洗可把缺参数 read_file/research 改成 reasoning，甚至无法解析时注入“知识图谱直接回答”节点。未发现对应知识图谱存储/查询实现，这个名称只是降级文案。清洗提高了“总能有节点”的比例，也可能隐藏计划失败。需要单独记录 plan_valid、plan_repaired、plan_fallback。

现有解析器接受单个 peer_review 节点，而执行要求至少三节点；已有观察表明该组合在运行期失败。`ensurePeerReviewPlan` 只要已有任一 peer_review 就不补齐，结构契约没有闭合。

### 3）上下文怎样传递？

Executor 保存 `results` 和 `sessionContextMessages`。research 结果经格式化作为 assistant 历史加入，reasoning 又拿到子任务 JSON 和引用列表；通用文件结果只取前 500 字符预览。它不是节点之间有类型的消息总线（Message Bus）。

R1/R2 收到同一投稿原文；debate 收到两份意见；Chair 收到投稿、两份意见、debate 和可选人工指令。同行评审组未接收之前 research 的 sources/results 参数，创新性角色的“对比近三年工作”主要是 Prompt 要求，并不自动验证最新文献。

### 4）有无重复推理/检索/调用？

有静态明确的重复机会：综述强制至少两个 research 节点，宽泛检索式又可能各扩展三路；没有按规范化 query 的轮内缓存。reasoning 仍可调用搜索和综述工具。检索片段既进历史又进 JSON，长投稿原文加完整章节切片也重复。

这不意味着所有重复都无意义：双向检索可能提高覆盖。但需用新增独特来源数、边际相关证据和成本证明收益。没有实际 Token 轨迹，不能给出“浪费多少百分比”。

### 5）失败后怎样恢复？

通用节点捕获异常、记录失败摘要并继续；模型结构化规划失败会再尝试纯文本；最终还可能降级为 reasoning。LLM 调用设置 60 秒期限，reasoning 工具循环上限为 12 步；搜索有 45 秒 fetch timeout，重排/外部解析缺统一超时。

没有完整的分类退避重试（Exponential Backoff）、跨节点幂等或补偿机制。错误流事件被忽略可返回 partial；run 没有汇总失败状态。不能把正常函数返回等同于任务完成。

### 6）中断是否能从检查点继续？

模块层面可以：`peer-review-checkpoint.ts` 解析阶段快照，runner 收到已完成阶段后跳过相应 LLM 调用，现有受控测试覆盖 R1 缓存。

产品闭环未成立：Job POST 新建任务，GET 只读，无旧任务 resume API/worker；失败分支可覆盖 checkpoint。R1 成功/R2 失败时，Promise.all 拒绝发生在写检查点之前，已观察到 0 次 checkpoint 回调。不能宣称重启恢复或断点续跑已经完整实现。

### 7）有无并发状态竞争？

节点快照 `void update...` 不等待、不排队；onNodePatch 用单项 `{id,patch}` 替换 nodes。晚到的中间快照可能覆盖最终状态；数据库没有 version/CAS，通用状态也没有单调转换保证。此项为静态风险，未做新的写入乱序或进程崩溃实验。

人工干预 Map 是进程内状态，浏览器与服务端、多副本之间不共享。前端流更新还会触发消息持久化定时器，切会话/关闭页面等生命周期需浏览器验证。

### 8）有无无效 Token 消耗？

已确认预算配置失真：512 被提高到至少 8192，实际本地 HTTP 替身看到 8192 请求参数；这是最大允许输出，不是实际消费 8192 Token。规划/评审未统一应用输出上限，query 改写没有记录 usage，工具内部调用和 SDK 多步 usage 统计还需核对。

服务端账本可记录部分模型 usage，但主 UI 在浏览器执行，没有注入 recorder；因此账本不能提供全量成本。搜索被折算为“等效 Token”，不是供应商真实账单。应分别保存真实模型 Token、搜索调用次数、重排候选数量和价格版本。

### 9）终止条件是否明确？

通用 for 循环走完节点结束；reasoning 最多 12 工具步骤，LLM 单次 60 秒。固定评审正常为两个独立评审、一次单向 debate 和一次 Chair 汇总，没有多轮迭代到“共识”的算法。

但人工批准等待无 TTL（Time to Live），可无限等候；外部 rerank/layout 无 timeout；节点总数无明确上限，整轮无总预算。默认 `shouldTriggerPeerReviewBreakpoint` 总返回 true，带 sessionId 即使意见一致也暂停。

### 10）人工干预能否影响后续？

同一运行域内，redirect 指令会加入 Chair Prompt，可跳过 debate 并插入 reasoning 节点，说明有实际分支逻辑。插入节点的 `humanInstruction` 没有被通用 reasoning 明确读取，不能确保第二次改写遵从指令。

普通 UI 的 executor 等待浏览器 Map，按钮却请求服务端 Map，缺少桥接；服务端 Job 的 waiting/resolve 可在同进程成立。完整真实浏览器闭环**未完成验证**。已有授权次序问题仅归入防御性整改，不继续复现；受安全策略限制，未进一步验证。

## 2. 历史 118 条测试的正确解读

历史报告时间为 2026-06-01T19:23:05.874Z。118 条中 84 条同时满足非空回复和路由匹配，34 条均为 route mismatch，没有 empty_reply 或 errors。direct_chat 16/48=33.3%，不是“只有三分之一能回答”。历史平均 13,864 ms 是逐任务耗时均值，414,001 ms 是并发 4 的总墙钟时间，二者分母不同。

已离线执行当前 `isDirectChatInput` 对原报告 118 个输入的分类，84 条匹配原标签，且与历史 actualRoute 全部一致。[回放文件](evidence/current-route-replay.json)

具体仍走 workflow 的历史 direct 标签例子：“有什么功能”“1+1等于几”“什么是机器学习”“什么是embedding”。第一条不匹配当前有限功能询问正则，后几条不在直聊白名单。标签是否合理需要预先定义：普通知识问题能否直接回答是产品策略，不应只按函数现状决定。

当前 `scripts/test-agent-batch-100.mjs` 与历史口径不同：问候为 direct_greeting，一般知识问答已改为 workflow_qa；且预检查要求 expectRoute 与同一个 isDirectChatInput 一致。这只能检查脚本自洽，不能作为独立人工标签的路由准确率（Routing Accuracy）。脚本还用 Promise.race 超时却不取消 executor，可能有后台调用；不记录真实 Token，也不验证答案/来源正确。当前完整批量模型执行**未执行**。

简单问答走 workflow，正常路径比直聊多一次规划调用；若规划出更多节点，调用量进一步增加。额外延迟应实际测 `plan_ms + additional_steps_ms`，额外成本按新增调用的真实输入输出 Token 和当期价格计算。本地 stub 的两次请求证明控制路径，不作为供应商延迟或费用数据。

## 3. 现有指标能力与缺口

- **任务完成率（Task Completion Rate）**：没有独立成功标准。非空文本/Job done 不能替代正确答案或完成工具目标。建议每条用例定义可验证产物、必需工具和失败条件，人工复核主观任务。
- **路由准确率（Routing Accuracy）**：可离线计算规则结果，但需独立冻结标签。按 direct/reasoning/research/peer_review 分类别，另报混淆矩阵（Confusion Matrix），不能让改实现的人同步改测试期望。
- **执行成功率（Execution Success Rate）**：已有节点错误与时长，但 nodes 返回状态不正确，需结构化 step/run 结果。分别报告基础设施成功和任务正确，错误降级不能算原目标成功。
- **延迟（Latency）**：有节点 performance.now、部分流 TTFT；缺完整端到端轨迹。分别记规划、搜索、重排、生成、持久化、人工等待，给 p50/p95。人工等待同时报告包含与排除后的时间。
- **Token 消耗（Token Consumption）**：部分服务端 usage 可记录，主 UI、query rewrite、多步工具等覆盖不足；字符估算不得与供应商 usage 混算。
- **单任务成本（Cost per Task）**：现有硬编码价格、默认回退价格、搜索等效 Token，不能称为精确账单。记录价格日期/币种、模型版本、缓存命中、搜索/重排费用和失败尝试，未定价单独标 unknown。

最小记录建议：run_id、case_id、commit、model/version、seed（供应商支持时）、route、plan/fallback 状态、step_id/dependencies、开始/结束、最终状态、全部调用 usage、人工等待、检索快照 ID、产物与人工判定。敏感内容做最小保留和脱敏。

## 4. 可复现的 A/B/C 消融方案（未实施）

目标先限定“投稿摘要/实验设计评审”，不要把聊天、搜索和代码审计混为一个总分。固定 60-100 个有许可的样例作为初始设计规模，其中至少一部分由两位标注者独立评价；具体规模随标注工作量调整。

- **A Single-Agent**：一次模型调用，按同一 rubric 输出完整评审。
- **B Multiple Independent Agents**：两个独立角色各写评审，确定性拼接结果；不读彼此意见，不加入额外模型汇总。
- **C Collaborative Multi-Agent**：同样两个角色，增加一次 debate 和一次 Chair。额外可设“两个独立意见 + Chair、无 debate”对照，用来区分汇总收益和辩论收益。

同一基础模型、语料快照、输入长度上限、任务 rubric 和总 Token 预算；每条件每样例至少重复 3 次作为初始方案，随机化顺序，记录供应商版本漂移。先禁用人工干预，再把相同人工规则作为单独实验；不能让 C 额外接受人工答案。

同时给两种公平比较：等总预算（各条件共享总输入输出预算）和同质量目标下的成本曲线。仅比较等输出长度或等单次调用上限不公平；C 多次重复读取材料的输入成本也计入。C 的固定评审链为 4 次生成调用，若从通用 Planner 进入通常还有一次规划；应把共同规划成本单独列出。

评价：实验建议可执行性、关键缺陷覆盖、错误批评数量、证据支持率、遗漏重大问题、总体任务达成率；配 p50/p95 延迟、总 Token、真实费用。盲评和冲突仲裁是主要质量证据，LLM-as-a-Judge 只作辅助并先校准；对每样例做配对比较与 Bootstrap 置信区间，不提前填结果。

## 5. 下一步最小验收

先修 run/step 状态与数据入口，使每次调用能被追踪；再构建独立路由标签和小型任务 rubric；最后做 A/B/C。建议先交付一份结果 JSONL、固定配置、数据哈希、计算脚本和可复核失败案例，再写“完成率提高”类简历句子。
