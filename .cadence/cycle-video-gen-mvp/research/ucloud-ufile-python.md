# UCloud UFile（对象存储 US3）Python 后端接入调研

> 调研主题：UCloud UFile 从 Python 后端接入的完整方式（SDK / 鉴权 / 上传 / 预签名 URL / bucket / region / CORS / 限制）
> 调研日期：2026-05-12

## 1. 一句话结论

UCloud UFile（现称 US3）有官方维护中的 Python SDK `ufile`（PyPI 包名 `ufile`，2025-02 仍在更新），覆盖上传 / 流式上传 / 私有下载 URL 生成；同时 US3 提供 S3 v4 兼容接入层（endpoint 形如 `https://s3-cn-bj.ufileos.com`），可直接用 `boto3` 接入。本场景（5–50MB mp4、单用户串行、后端代理转存 + 私有 URL 播放）**推荐用官方 `ufile` SDK**，理由是 `private_url` 一行出预签名 URL，签名细节完全屏蔽，不需要纠结 boto3 path-style/virtual-host 的兼容陷阱。

## 2. 关键事实

### 2.1 官方 Python SDK（`ufile`）
- 仓库：https://github.com/ucloud/ufile-sdk-python ；PyPI 包名 `ufile`。
- 维护状态：**仍在维护**。最新版 `3.2.11`（2025-02-26 发布），上一版 `3.2.10`（2025-02-25），2024-05 还发过 `3.2.9`。共 15 个版本，首版 2018-12。
- 兼容 Python 版本：README 声明 Python 2.6+ / 3.3+。**未明示 Python 3.10/3.11/3.12 测试矩阵**——本项目用 FastAPI 一般是 3.10+，需要联调验证（通常没问题，但属于"未明确声明"）。
- 仅依赖 `requests`。
- 安装：`pip install ufile`。

### 2.2 S3 兼容接入层（可用 boto3）
- US3 兼容 **AWS S3 v4 协议**（不是 v2），是在自有协议之上增加的兼容层。
- Endpoint 形如 `https://s3-<region>.ufileos.com`，例如北京一为 `https://s3-cn-bj.ufileos.com`，上海二为 `https://s3-cn-sh2.ufileos.com`。
- 凭证映射：boto3 的 `aws_access_key_id` = UCloud `PublicKey`，`aws_secret_access_key` = UCloud `PrivateKey`（也可用 US3 Token）。
- `region_name` 直接填地域代码（如 `cn-bj`、`cn-sh2`）。
- **建议使用 path-style 寻址**（`addressing_style: 'path'`）：第三方 S3 兼容服务一般没有为每个 bucket 配通配符 DNS，virtual-hosted 不一定可靠。这是通行经验，UCloud 官方文档同时声明两种 URL 风格都支持，但 boto3 接入时优先 path-style 更稳。
- **S3 接入层的硬限制（与原生 UFile 不同！）**：
  - PutObject 单文件上限 **1GB**（不是 AWS 的 5GB）
  - PostObject 上限 32MB
  - CopyObject 上限 100MB
  - UploadPart 分片**固定 8MB**（最后一片可小于），如需可变分片要联系技术支持
  - ETag 计算方式与 AWS 不一致，**不要依赖 ETag 做完整性校验**
- HTTPS 仅在部分地域支持（北京二、香港、胡志明、首尔、圣保罗、洛杉矶、华盛顿等）；其他地域需用 HTTP，cn-bj 是否支持 HTTPS **未明确确认**，需联调验证。

### 2.3 鉴权机制（原生 UFile 协议）
- 签名算法：**HMAC-SHA1**（不是 v4）。
- 两种用法：
  - **Authorization 头**方式：`Authorization: UCloud <PublicKey>:<Signature>`
  - **URL 查询字符串**方式（即预签名 URL）：在 URL 上加 `UCloudPublicKey`、`Expires`、`Signature` 三个 query 参数
- StringToSign（URL 签名版）：
  ```
  HTTP-VERB + "\n" +
  Content-MD5 + "\n" +
  Content-Type + "\n" +
  Expires + "\n" +
  CanonicalizedUCloudHeaders +
  CanonicalizedResource
  ```
  其中 `CanonicalizedResource = "/" + Bucket + "/" + Key`。
- 计算：`Signature = URL-Encode( Base64( HMAC-SHA1(PrivateKey, StringToSign) ) )`。
- **用 SDK 时这些细节全屏蔽**，传公私钥即可。

### 2.4 原生上传 / 流式上传
- `ufile.filemanager.FileManager(public_key, private_key)`。
- `putfile(bucket, put_key, local_file, header=None)` 走本地路径上传。
- `putstream(bucket, put_key, stream, header=None)` 走 file-like 对象上传——**ModelVerse 视频 URL → requests stream → putstream 是最自然的链路**。
- Content-Type 通过 `header` 参数透传，例如 `header={'Content-Type': 'video/mp4'}`。如果不传，SDK 会按文件名后缀猜，但流式上传时无文件名，**必须显式传 Content-Type**（否则前端 video 标签可能识别失败）。
- 完整性校验：`config.set_default(md5=True)` 可让 putfile / putstream 加 Content-MD5 头。

### 2.5 预签名（私有下载）URL
- 方法：`ufile_handler.private_url(bucket, put_key)` → 返回带 `Expires` 的下载 URL。
- 过期时间通过全局 config 设置：`config.set_default(expires=<秒数>)`（默认 60 秒）。
- 也可在调用时按需修改 config，或自己拼 query string。
- **过期上限未在 UCloud 官方文档中找到明确数值**——AWS S3 标准是 7 天（604800 秒），US3 是否同样有 7 天上限**未确认，需联调验证**。本场景如果按"播放视频时按需签发，给 1–6 小时"是安全区间。
- 生成的 URL **可以直接当 `<video src>` 用**（前提是 bucket 已配 CORS，见 §2.7）。
- URL 在过期前可重复使用（不限次数）。

### 2.6 Bucket 创建与 region
- API 名：`CreateBucket`（走 https://api.ucloud.cn，不是 S3 接入层）。
- 必填参数：`BucketName`、`Type`（`private` / `public`）、`Region`（地域代码）。可选 `ProjectId`。
- 单账号 bucket 上限 **20 个**。
- 也可以直接在 UCloud 控制台点几下创建——MVP 场景**强烈建议手动建一次**，不要写代码自动建。
- Region 代码列表（本场景大概率选 `cn-bj` 或 `cn-sh2`）：
  - `cn-bj` 北京一、`cn-sh2` 上海二、`cn-gd` 广州、`cn-wlcb` 华北二
  - 海外：`hk` 香港、`us-ca` 洛杉矶、`sg` 新加坡、`jpn-tky` 东京、`kr-seoul` 首尔 等共 20 个
- 域名格式：`<bucket>.<region>.ufileos.com`，例如 `mybucket.cn-bj.ufileos.com`（**虚拟主机风格，bucket 在域名前**，不是子路径）。
- 注意：bucket 创建/删除**必须用公私钥**；只做文件读写时官方建议用 Token（更安全）。MVP 单租户后端用公私钥也可以接受。

### 2.7 CORS 配置
- 官方文档：https://docs.ucloud.cn/ufile/guide/cors （控制台）和 https://docs.ucloud.cn/api/ufile-api/add_cors_rule （API）。
- API 名：`AddCORSRule`（走 https://api.ucloud.cn）。
- 关键参数：`BucketName`、`Origin`（允许源）、`Method`（允许方法）、`Header`（允许请求头）、`ExposeHeader`（暴露给客户端的响应头）、`MaxAge`（预检缓存秒数）。
- **必须配 CORS 才能让浏览器 `<video>` 直接播放**，否则跨域 + Range 请求会被拦。
- `<video>` 流式播放需要的最小配置：
  - `Method`：`GET`、`HEAD`
  - `Header`：`Range`、`Origin`（或 `*`）
  - `ExposeHeader`：`Content-Length`、`Content-Range`、`Accept-Ranges`（缺这几个 seek/进度条会出问题）
  - `Origin`：开发期可以 `*`，上线建议显式列出前端域名
- 一条规则一个 Origin（参考 S3 行为，**未在 UCloud 文档中明确确认是否支持多 Origin**，安全做法是为每个域名建一条规则）。
- MVP 阶段建议在控制台点配置，不在代码里跑 AddCORSRule（一次性动作）。

### 2.8 文件大小与并发
- 单文件大小：原生 UFile **简单上传 ≤ 512MB**，超过用分片上传（每片 ≥ 4MB，末片除外）。S3 接入层 PutObject 上限 **1GB**。本场景 mp4 5–50MB，**远低于上限**，用 putstream / put_object 单次上传即可，**不需要做分片**。
- 并发上传数：UCloud 官方文档**未给出明确数字限制**——需联调验证。本场景"单用户单任务串行"，并发只有 1，不是约束。
- 速率限制（QPS / 带宽）：**未在公开文档中查到明确账户级 QPS 上限**，需在控制台或工单确认。MVP 场景可忽略。

## 3. 取舍对比：官方 `ufile` SDK vs boto3 (S3 兼容)

| 维度 | 官方 `ufile` SDK | boto3 + S3 兼容 endpoint |
|---|---|---|
| 维护状态 | UCloud 官方维护，2025-02 还在更新 | boto3 是 AWS 官方，永远活跃；US3 兼容层维护情况由 UCloud 决定 |
| 安装 | `pip install ufile`，仅依赖 `requests` | `pip install boto3`，依赖较重（botocore 等） |
| 鉴权 | 自动处理（HMAC-SHA1）| 自动处理（SigV4） |
| 单文件上限 | 简单上传 512MB | PutObject 1GB |
| 预签名 URL | `private_url(bucket, key)` 一行 | `generate_presigned_url('get_object', ...)` |
| 流式上传（ModelVerse 字节流转存）| `putstream(bucket, key, stream, header={'Content-Type':'video/mp4'})` 直接吞 file-like | `put_object(Bucket=..., Key=..., Body=stream, ContentType='video/mp4')` 也支持 file-like |
| 寻址陷阱 | 无 | 需要显式 `addressing_style='path'`，否则可能 403 |
| Content-Type 控制 | 通过 header 参数 | `ContentType` 字段 |
| Range 下载 / `<video>` 兼容 | ✅（标准 GET，浏览器 Range 直通）| ✅ 同 |
| ETag 可信 | UFile 自有计算 | UCloud ETag 算法与 AWS 不同，**不要依赖** |
| HTTPS 区域限制 | 同 | 同 |
| 文档数量 | 中等，README + examples 足够 | 极多（boto3 文档），但兼容细节要看 UCloud S3 文档 |
| 学习成本 | 极低 | 低（如果团队熟 boto3 更低） |
| 锁定风险 | 锁 UCloud | 低，未来切别家 S3 兼容只换 endpoint |

**推荐**：本 MVP 用**官方 `ufile` SDK**。理由：
1. ModelVerse 已经锁 UCloud 账号体系，没有"未来切云"的需求，boto3 的可移植性优势不成立
2. `private_url(bucket, key)` 比 boto3 配 `addressing_style` + `signature_version` + `endpoint_url` 三件套要简单
3. 文件 5–50MB 远低于两者上限，没有"非 boto3 不可"的硬约束
4. 如果后续真要切 boto3，业务层只需要重写 `upload_video()` 和 `get_play_url()` 两个函数，迁移成本可控

**反向理由**：如果团队对 boto3 熟到肌肉记忆 / 已经在用 boto3 处理别家 S3，那直接复用 boto3 也合理，注意三个坑：① `addressing_style='path'` ② `signature_version='s3v4'` ③ ETag 不可信。

## 4. 代码示例

### 4.1 推荐方案：官方 `ufile` SDK

```python
# pip install ufile requests
import requests
from ufile import config, filemanager

PUBLIC_KEY = "your_public_key"
PRIVATE_KEY = "your_private_key"
BUCKET = "video-mvp"
REGION_SUFFIX = ".cn-bj.ufileos.com"  # 视 bucket 所在 region 改

# 全局配置（一次即可）
config.set_default(uploadsuffix=REGION_SUFFIX)
config.set_default(downloadsuffix=REGION_SUFFIX)
config.set_default(connection_timeout=60)
config.set_default(expires=3600)        # 私有下载 URL 默认 1 小时
config.set_default(open_ssl=True)       # 走 HTTPS（确认 region 支持）

handler = filemanager.FileManager(PUBLIC_KEY, PRIVATE_KEY)


def transfer_modelverse_video_to_ufile(modelverse_url: str, object_key: str) -> str:
    """从 ModelVerse 临时 URL 流式拉取并直传到 UFile，返回 object_key。"""
    with requests.get(modelverse_url, stream=True, timeout=300) as r:
        r.raise_for_status()
        # putstream 接受 file-like；requests 的 raw 即 file-like
        # 关键：必须显式 Content-Type，否则浏览器播放可能识别失败
        ret, resp = handler.putstream(
            BUCKET,
            object_key,
            r.raw,
            header={"Content-Type": "video/mp4"},
        )
        assert resp.status_code == 200, f"upload failed: {resp.status_code} {ret}"
    return object_key


def get_play_url(object_key: str, expires_seconds: int = 3600) -> str:
    """生成带过期时间的私有下载/播放 URL，可直接给 <video src> 用。"""
    # 临时改 expires；如多线程要注意 config 是全局的
    config.set_default(expires=expires_seconds)
    return handler.private_url(BUCKET, object_key)
```

### 4.2 兜底方案：boto3 接 S3 兼容层

```python
# pip install boto3
import boto3
from botocore.client import Config

s3 = boto3.client(
    "s3",
    aws_access_key_id="your_public_key",
    aws_secret_access_key="your_private_key",
    endpoint_url="https://s3-cn-bj.ufileos.com",  # 注意 https 仅部分 region 支持
    region_name="cn-bj",
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},  # 关键：用 path-style，避免子域名 DNS 问题
    ),
)


def upload(stream, key: str):
    s3.put_object(
        Bucket="video-mvp",
        Key=key,
        Body=stream,
        ContentType="video/mp4",
    )


def get_play_url(key: str, expires: int = 3600) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": "video-mvp", "Key": key},
        ExpiresIn=expires,  # 上限未在 US3 文档中确认，AWS 标准是 7 天
    )
```

### 4.3 CORS 配置（控制台一次性配，仅供参考最小项）

```
AllowedOrigin: http://localhost:5173, https://your-frontend.com
AllowedMethod: GET, HEAD
AllowedHeader: Range, Origin
ExposeHeader: Content-Length, Content-Range, Accept-Ranges
MaxAge: 3600
```

## 5. 引用来源

- [ucloud/ufile-sdk-python (GitHub 官方仓库)](https://github.com/ucloud/ufile-sdk-python) — 官方 Python SDK，2026-05-12 抓取
- [ufile 3.2.11 on PyPI / Libraries.io](https://libraries.io/pypi/ufile) — SDK 维护历史与版本，2026-05-12 抓取
- [AWS S3 协议支持说明 - 对象存储 US3](https://docs.ucloud.cn/ufile/s3/s3_introduction) — S3 兼容性、endpoint、签名版本、限制，2026-05-12 抓取
- [Object Storage Service (US3) - UCloud Global - S3 Introduction](https://www.ucloud-global.com/en/docs/ufile/devguide/s3/s3_introduction) — S3 接入限制英文版（含 PutObject 1GB 等具体数字），2026-05-12 抓取
- [API 签名算法 - 对象存储 US3](https://docs.ucloud.cn/ufile/api/authorization) — Authorization 头签名算法（HMAC-SHA1），2026-05-12 抓取
- [在 URL 中包含签名 - 对象存储 US3](https://docs.ucloud.cn/ufile/api/authorization-url) — 预签名 URL 的 StringToSign 拼法和 Expires 参数，2026-05-12 抓取
- [创建 Bucket - CreateBucket - 对象存储 US3](https://docs.ucloud.cn/api/ufile-api/create_bucket) — CreateBucket API 参数，2026-05-12 抓取
- [地域和域名 - 对象存储 US3](https://docs.ucloud.cn/ufile/introduction/region) — 全部 region 代码与域名格式，2026-05-12 抓取
- [跨域访问 - 对象存储 US3](https://docs.ucloud.cn/ufile/guide/cors) — CORS 控制台配置指南，2026-05-12 抓取
- [添加跨域规则 - AddCORSRule - 对象存储 US3](https://docs.ucloud.cn/api/ufile-api/add_cors_rule) — CORS 规则 API 参数，2026-05-12 抓取
- [使用限制 - 对象存储 US3](https://docs.ucloud.cn/ufile/introduction/limit) — 简单上传 512MB / 分片 4MB 等限制，2026-05-12 抓取
- [Boto3 文档 - Presigned URLs](https://docs.aws.amazon.com/boto3/latest/guide/s3-presigned-urls.html) — boto3 generate_presigned_url 用法，2026-05-12 抓取
