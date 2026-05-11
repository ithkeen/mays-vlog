# UFile bucket CORS 配置

前端在 `<video>` 标签上直接播放后端签发的 UFile 预签名 URL，必须先在 UFile
bucket 上配 CORS，否则浏览器会拦截跨域请求（含 `<video>` 自动发起的 Range
请求），导致播放失败、seek 跳到 0、下载断流等问题。

本项目播放/下载链路只走 GET / HEAD（上传与删除走后端，浏览器不直连 UFile），
因此只需要最小集合的 CORS 规则即可。建议在 UCloud 控制台「对象存储 US3 →
bucket → 跨域配置」中**手工添加一条规则**（一次性动作，MVP 不在代码里跑
`AddCORSRule` API）。

## 最小配置

| 字段 | 取值 | 说明 |
|---|---|---|
| **AllowedOrigins** | 开发期：`http://localhost:5173`<br>生产：填具体前端域名（如 `https://your-frontend.example`） | 一条规则一个 Origin；多个域名建多条规则。开发期临时图方便也可填 `*`，**上线前务必收窄到具体域名** |
| **AllowedMethods** | `GET`、`HEAD` | 仅播放/下载；不在前端做上传/删除（这些走后端 + UFile SDK） |
| **AllowedHeaders** | `Range`、`Origin` | `Range` 是 `<video>` 进度条 seek 必需；`Origin` 是 CORS 预检触发的标准请求头 |
| **ExposeHeaders** | `Content-Length`、`Content-Range`、`Accept-Ranges` | **缺这三个 seek/进度条会出问题**：浏览器拿不到总长度时进度条停留在 0；拿不到 `Content-Range` 时 seek 后无法续播；拿不到 `Accept-Ranges` 时部分浏览器直接禁用 seek |
| **MaxAgeSeconds** | 开发期：`3600`（1 小时）<br>生产：`86400`（1 天） | 控制 OPTIONS 预检结果在浏览器侧缓存多久。开发期短一点便于改 CORS 后立刻生效；上线后调大减少预检开销 |

## 控制台等价配置（截图对照用）

```
AllowedOrigin:   http://localhost:5173       (开发)
                 https://your-frontend.example (生产)
AllowedMethod:   GET, HEAD
AllowedHeader:   Range, Origin
ExposeHeader:    Content-Length, Content-Range, Accept-Ranges
MaxAge:          3600
```

## 验证步骤

CORS 生效后，在前端浏览器中触发一次视频播放，打开 DevTools → Network 面板：

1. 应能看到对 `*.ufileos.com` 域名的 `OPTIONS` 预检请求 → 200
2. 紧跟一个 `GET` 请求（带 `Range: bytes=...`）→ 206 Partial Content，响应头含
   `Content-Length` / `Content-Range` / `Accept-Ranges`
3. 视频可正常播放、可拖动进度条 seek

如出现以下症状，按图索骥：

- **红色 CORS 错误（"blocked by CORS policy"）**：检查 `AllowedOrigins`
  是否覆盖了当前前端 host（含端口）
- **进度条停留在 0 / 拖动后跳回 0**：检查 `ExposeHeaders` 是否包含
  `Content-Length` / `Content-Range`
- **进度条不可拖动 / `<video>` 显示 "无法播放"**：检查 `ExposeHeaders` 是否
  包含 `Accept-Ranges`，以及 `AllowedHeaders` 是否包含 `Range`
- **OPTIONS 预检 4xx**：检查 `AllowedMethods` 是否含对应方法、`AllowedHeaders`
  是否覆盖客户端实际发送的 `Access-Control-Request-Headers`

## 参考

- UCloud 官方控制台文档：https://docs.ucloud.cn/ufile/guide/cors
- UCloud `AddCORSRule` API：https://docs.ucloud.cn/api/ufile-api/add_cors_rule
- 项目调研档：`.cadence/cycle-video-gen-mvp/research/ucloud-ufile-python.md` §2.7 / §4.3
