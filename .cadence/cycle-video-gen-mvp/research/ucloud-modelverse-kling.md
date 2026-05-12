# UCloud 星图（UModelVerse）可灵 Kling 视频生成 API 接入调研

> 调研主题：UCloud（优刻得）"星图"产品下"可灵（Kling）"视频生成模型的 API 接入方式：鉴权机制、接口路径、提交参数、异步任务轮询、错误码、文生/图生差异、模型 ID 命名约定
> 调研日期：2026-05-12

## 1. 一句话结论

UCloud 星图就是 **UModelVerse**（域名 `api.modelverse.cn`），所有 Kling 视频模型走**统一异步任务网关**（`POST /v1/tasks/submit` 提交 + `GET /v1/tasks/status?task_id=...` 轮询），用 **`Authorization: Bearer <API_KEY>`** 简单鉴权；本次 MVP 推荐直接用 **`kling-v3`** 这一个 model id，**文生/图生靠是否传 `parameters.image` 自动切换**，不需要选两个不同 endpoint，也不需要 UCloud 传统的 PublicKey/PrivateKey 签名。

## 2. 关键事实

### 2.1 平台与 base URL

- 产品名："星图" 对外品牌即 **UModelVerse**（中文文档里也叫"模型服务平台 UModelVerse"），不是传统 UCloud 控制台那套 `api.ucloud.cn` 的 PublicKey/PrivateKey 签名体系
- Base URL（国内）：`https://api.modelverse.cn`
- Base URL（海外备份）：`https://api.umodelverse.ai`
- 文档入口：`https://docs.ucloud.cn/modelverse/`，源仓库 `github.com/uclouddoc-team/modelverse`

### 2.2 鉴权（关键，纠正误解）

- **不需要 UCloud PublicKey/PrivateKey 签名**。Kling 走 ModelVerse 网关，等同 OpenAI 风格 Bearer token
- 请求头：`Authorization: Bearer <MODELVERSE_API_KEY>`
- 备选头：`x-goog-api-key: <MODELVERSE_API_KEY>`（Gemini 兼容口才用，REST 任务 API 用 Bearer 即可）
- API Key 在 ModelVerse 控制台获取
- **API Key 必须放后端**——这点本次 MVP 已经确认

> 注意：context7 中部分 cURL 示例写的是 `Authorization: <YOUR_API_KEY>`（无 `Bearer ` 前缀）。官方 Authentication 章节明确要求 `Bearer ` 前缀。**实施时按 `Bearer ` 前缀传**，更兼容；如服务端报 401 再回退试不带前缀。

### 2.3 异步任务模型（所有视频模型统一）

视频生成全异步，两步：

1. **提交**：`POST https://api.modelverse.cn/v1/tasks/submit`，返回 `output.task_id`
2. **轮询**：`GET https://api.modelverse.cn/v1/tasks/status?task_id=<task_id>`，直到 `output.task_status` 变为 `Success` / `Failure`

#### 提交响应（成功）

```json
{
  "output": { "task_id": "task_abc123xyz" },
  "request_id": "req_xxx"
}
```

#### 轮询响应（成功）

```json
{
  "output": {
    "task_id": "task_abc123xyz",
    "task_status": "Success",
    "urls": ["https://xxxxx/xxxx.mp4"],
    "submit_time": 1756959000,
    "finish_time": 1756959050
  },
  "usage": { "duration": 4 },
  "request_id": ""
}
```

#### 轮询响应（失败）

```json
{
  "output": {
    "task_id": "...",
    "task_status": "Failure",
    "submit_time": 1756959000,
    "finish_time": 1756959019,
    "error_message": "..."
  },
  "request_id": ""
}
```

#### 状态机

`Pending` → `Running` → `Success` | `Failure`

#### 典型耗时

官方文档没给 Kling 视频明确 SLA。同类（阿里云百炼可灵）公开口径是 **1～5 分钟**。本次 MVP 应按 **5 分钟硬上限 + 5～10 秒轮询间隔**做超时设计，**未确认 UCloud 侧实际 P95，需联调验证**。

### 2.4 模型 ID（重要：本次 MVP 选 `kling-v3`）

UCloud ModelVerse 上 Kling 系列在售 model 字符串（截至 2026-05）：

| model 字段 | 用途 | 备注 |
|---|---|---|
| `kling-v3` | **文生 + 图生（同一字符串）** | 本次 MVP 首选；最干净的接入路径 |
| `kling-v3-omni` | 多模态视频生成（文/图/视频引用） | 复杂，MVP 不需要 |
| `kling-v3-motion-control` | 角色动作迁移（图+参考视频） | 不适用 |
| `kling-video-o1` | 老一代 Kling，参数分散在 `image_list` | 兼容性老接口 |

**强烈建议本次 MVP 直接用 `kling-v3`**：单一 model id，文生/图生切换零分支逻辑（见 2.5）。

> 关于 `kling-v2-6/文生视频`、`kling-v2-6/图生视频` 这种带斜杠的命名：
> WebSearch 摘要里出现过这种写法，但 context7 官方文档库里**未找到 v2-6 独立条目**，疑似是平台前端侧的展示分类（"模型/能力"）。**未确认 v2-6 实际 model 字段值**。MVP 用 `kling-v3` 可绕开此疑问。

### 2.5 文生 vs 图生：`kling-v3` 的差异（核心）

`kling-v3` 通过**有没有 `parameters.image`** 自动判断模式，**不是切换 endpoint**。

#### 文生视频（最小请求）

```json
{
  "model": "kling-v3",
  "input": {
    "prompt": "A cinematic shot of a futuristic city"
  },
  "parameters": {
    "mode": "std",
    "duration": 5
  }
}
```

#### 图生视频（最小请求）

```json
{
  "model": "kling-v3",
  "input": {
    "prompt": "Slow camera dolly forward, cinematic"
  },
  "parameters": {
    "image": "<URL 或 Base64 字符串>",
    "mode": "std",
    "duration": 5
  }
}
```

差异只有一处：图生模式在 `parameters.image` 填首帧图。

#### `parameters.image` 字段 schema（图怎么传）

- 类型：单字符串
- 内容：**公网可访问的 URL** 或 **裸 Base64**（不要带 `data:image/png;base64,` 前缀）
- 不支持 multipart/form-data
- 图片要求：
  - 格式 `.jpg` / `.jpeg` / `.png`
  - 大小 ≤ 10MB
  - 短边 ≥ 300px
  - 宽高比在 1:2.5 ~ 2.5:1 之间
- 可选 `parameters.image_tail`：尾帧图（需先设 `image`），MVP 不用

> **MVP 实现建议**：浏览器选图后，前端 base64 编码（`FileReader.readAsDataURL` 截掉前缀）→ POST 给后端 → 后端原样塞进 `parameters.image`。无需对象存储中转。但如果用户图很大（接近 10MB），base64 后请求体 ~13MB，**确认后端代理层和 ModelVerse 网关的 body size 上限**。未确认 UCloud 侧上限，**需联调验证**。

#### `kling-v3` 完整可选参数

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `model` | string | — | 必填，固定 `kling-v3` |
| `input.prompt` | string | — | 文本提示词，≤ 2500 字符；非 multi_shot 模式必填 |
| `input.negative_prompt` | string | — | 负向提示词，≤ 2500 字符 |
| `parameters.image` | string | — | 首帧图 URL 或 base64；填了就是图生 |
| `parameters.image_tail` | string | — | 尾帧图，需先有 `image` |
| `parameters.mode` | string | `std` | `std` (720P) / `pro` (1080P) |
| `parameters.aspect_ratio` | string | `16:9` | `16:9` / `9:16` / `1:1` |
| `parameters.duration` | int | `5` | 3~15 秒 |
| `parameters.sound` | string | `off` | `on` / `off` |
| `parameters.multi_shot` | bool | `false` | MVP 不用 |
| `parameters.watermark_enabled` | bool | — | 水印开关 |
| `parameters.external_task_id` | string | — | 自定义任务 ID（同一用户内唯一），便于追踪 |

> **MVP 后端默认参数建议**：`mode=std` + `aspect_ratio=16:9` + `duration=5` + `sound=off`。这样最便宜、最快、最稳。

### 2.6 错误码与错误结构

错误响应是 JSON，常见错误码（所有 ModelVerse 接口共用）：

| HTTP | type | code | 含义 / 处理建议 |
|---|---|---|---|
| 400 | invalid_request_error | `param_error` | 参数错误 / 调到不支持的接口 |
| 400 | invalid_request_error | `invalid_messages` | 内容触发敏感词 |
| 400 | invalid_request_error | `sensitive_check_error` | 合规检测失败 |
| 400 | invalid_request_error | `model_error` | 当前 key 没该模型权限 |
| 400 | invalid_request_error | `tokens_too_long` | prompt 太长 |
| 401 | invalid_request_error | `auth_error` | API Key 无效 |
| 408 | timeout | `timeout` | 请求超时，重试 |
| 429 | rate_limit_error | `rate_limit` | 限流，退避重试 |
| 500 | internal_error | `internal_error` | 服务端错误 |
| 500 | internal_error | `model_server_error` | 模型服务异常 |
| 504 | timeout | `gateway_timeout_error` | 网关超时 |

**对于异步任务**，提交阶段返回上述 HTTP 错误；**任务运行阶段**的失败通过轮询响应里 `output.task_status="Failure"` + `output.error_message` 透出，**不是 HTTP 错误**。前端"失败任务不入库"的逻辑要同时识别这两条路径。

### 2.7 限流 / 配额 / 并发

- 限流策略：超出会返 HTTP 429 `rate_limit`，**官方文档未公开具体 QPS / 并发数**
- **未确认是否对单账号有视频任务并发上限**（如"同时最多 N 个 Pending/Running 任务"）。**需联调验证**
- 对本次 MVP（单用户、单任务串行）的影响：
  - **后端串行锁是必要的**（不能依赖 ModelVerse 限流来串行化），因为 429 不等于"已串行"，可能只是触发了瞬时 QPS 超限
  - 串行锁实现：后端用一个简单的"是否有 in-flight task_id"内存标志即可，第二个请求来时直接 409 拒绝
  - 不要并发轮询多个 task_id（本就只有一个 in-flight，自然满足）

### 2.8 其它工程注意点

- **不要把 API Key 暴露给前端**：架构里**必须**有后端代理层包住 `/v1/tasks/submit` 和 `/v1/tasks/status` 两个调用。前端只与自家后端通信。
- **结果视频 URL 是临时签名 URL**：`output.urls[*]` 是 ModelVerse 侧 OSS（推测 ufileos）的链接，**有过期时间**。"成功结果进入浏览器本地历史"如果只存 URL，过几天会 404。**未确认有效期**，建议联调时实测；如果发现会过期，MVP 要么后端代理转存、要么前端把视频拉到 IndexedDB。**这是本调研发现的最大隐性风险**。
- **轮询节奏建议**：首次提交后 30 秒内不查（任务大概率还在 Pending），之后每 5～10 秒查一次，持续到 5 分钟硬超时。
- **`request_id` 留日志**：每次提交和轮询响应里的 `request_id`/`task_id` 都记日志，排查问题时给 UCloud 工单要用。

## 3. 取舍对比：选哪个 Kling 模型字符串

| 维度 | `kling-v3` | `kling-v3-omni` | `kling-video-o1` |
|---|---|---|---|
| 文生 / 图生切换方式 | 同一 model，靠 `parameters.image` 有无切换 | 同一 model，靠 `image_list` 有无切换 | 同一 model，靠 `image_list` 有无切换 |
| 图字段 schema | `parameters.image` 单字符串（最简） | `parameters.image_list[]` 带 type 的数组 | `parameters.image_list[]` 带 type 的数组 |
| 多模态/视频引用 | 不支持（够用） | 支持 | 部分支持 |
| 接入复杂度 | 最低 | 中 | 中 |
| 适合 MVP | **是** | 过度设计 | 老接口，无理由选 |

**推荐**：`kling-v3`。后端代码里 model 字段写死 `"kling-v3"`，文生/图生分支只需 `if (image) params.image = image;` 一行。

## 4. 代码示例（后端代理层最小实现，TypeScript / Node 18+ fetch）

```ts
// kling.ts —— UCloud ModelVerse Kling v3 最小代理
const BASE = "https://api.modelverse.cn";
const KEY = process.env.MODELVERSE_API_KEY!; // 仅后端持有

const headers = {
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

// 提交：image 传则图生，不传则文生
export async function submitKlingTask(opts: {
  prompt: string;
  image?: string; // URL 或裸 base64
}) {
  const body = {
    model: "kling-v3",
    input: { prompt: opts.prompt },
    parameters: {
      mode: "std",
      aspect_ratio: "16:9",
      duration: 5,
      sound: "off",
      ...(opts.image ? { image: opts.image } : {}),
    },
  };
  const r = await fetch(`${BASE}/v1/tasks/submit`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`submit ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.output.task_id as string;
}

// 轮询单次
export async function queryKlingTask(taskId: string) {
  const r = await fetch(
    `${BASE}/v1/tasks/status?task_id=${encodeURIComponent(taskId)}`,
    { headers: { "Authorization": `Bearer ${KEY}` } }
  );
  if (!r.ok) throw new Error(`query ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.output as {
    task_id: string;
    task_status: "Pending" | "Running" | "Success" | "Failure";
    urls?: string[];
    error_message?: string;
    submit_time?: number;
    finish_time?: number;
  };
}

// 轮询直到完成（5 分钟超时，10 秒间隔）
export async function waitKling(taskId: string, timeoutMs = 5 * 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await queryKlingTask(taskId);
    if (s.task_status === "Success") return s.urls!;
    if (s.task_status === "Failure") throw new Error(s.error_message ?? "kling failure");
    await new Promise(r => setTimeout(r, 10_000));
  }
  throw new Error("kling timeout");
}
```

前端只调自家两个端点：`POST /api/video`（带 prompt 和可选图 base64）→ 返回 `task_id`；`GET /api/video/:task_id` → 返回状态。前端**永远看不到** `MODELVERSE_API_KEY`。

## 5. 引用来源

- [UModelVerse 文档中心](https://docs.ucloud.cn/modelverse/) — 官方文档入口，2026-05-12 通过 WebSearch 发现
- [Kling/v3 API 文档](https://github.com/uclouddoc-team/modelverse/blob/master/api_doc/video_api/Kling-v3.md) — 官方源仓库，通过 context7 抓取，2026-05-12
- [Kling/O1 API 文档](https://github.com/uclouddoc-team/modelverse/blob/master/api_doc/video_api/Kling-O1.md) — 官方源仓库，通过 context7 抓取，2026-05-12
- [Kling/V3-Omni API 文档](https://github.com/uclouddoc-team/modelverse/blob/master/api_doc/video_api/Kling-O3.md) — 官方源仓库，通过 context7 抓取，2026-05-12
- [Kling v3 Motion Control API 文档](https://github.com/uclouddoc-team/modelverse/blob/master/api_doc/video_api/Kling-v3-Motion-Control.md) — 官方源仓库，通过 context7 抓取，2026-05-12
- [ModelVerse 通用错误码](https://github.com/uclouddoc-team/modelverse/blob/master/api_doc/common/error-code.md) — 官方源仓库，通过 context7 抓取，2026-05-12
- [ModelVerse 鉴权说明（Gemini 兼容）](https://docs.ucloud.cn/modelverse/api_doc/text_api/gemini_compatible) — 官方文档，2026-05-12 通过 WebSearch 发现
- [任务状态查询接口（Suno 文档示例，与视频共用同一 endpoint）](https://github.com/uclouddoc-team/modelverse/blob/master/api_doc/audio_api/suno.md) — 官方源仓库，通过 context7 抓取，2026-05-12
- [阿里云百炼可灵视频 API 参考（仅作为耗时口径旁证，非 UCloud 官方）](https://help.aliyun.com/zh/model-studio/kling-video-generation-api-reference/) — 第三方平台文档，2026-05-12 通过 WebSearch 发现
