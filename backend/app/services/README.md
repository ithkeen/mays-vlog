# `app/services/`

后端业务服务层：ModelVerse / UFile 第三方客户端 + 单任务编排器。

## 内容

- `modelverse.py`（T4）：UCloud 星图 ModelVerse `kling-v3` 视频生成客户端
  （`async submit_kling_task` / `async query_kling_task` / `ModelVerseError`）
- `ufile.py`（T5）：UCloud UFile 对象存储客户端
  （`upload_video_from_url` / `get_play_url` / `delete_object` / `UFileError`）
- `orchestrator.py`（T6）：单任务编排（后台 BackgroundTask + `asyncio.Lock` +
  轮询 + 超时 + 转存）

`modelverse.py` 与 `ufile.py` 的详细接口约定见 **[`backend/README.md`](../../../README.md)**。
本文档只写 `orchestrator.py` 的对外接口。

## 编排器 `orchestrator.py`

### 对外 API

| 符号 | 说明 |
|---|---|
| `async submit_task(prompt, image_base64, background_tasks)` | 抢锁 → 入库 `pending` → 调度后台 `_run_orchestration` → 返回 `{id, status:"pending", current_task_id}` |
| `get_play_url_for_task(task_id) -> str` | 仅 `status='success'` 任务签发 1 小时 UFile 预签名 URL；否则抛 `TaskNotPlayableError` |
| `in_flight: InFlightState` | 模块级单例，含 `lock: asyncio.Lock` 与 `current_task_id: str \| None` |
| `ConcurrentTaskError(current_task_id)` | 并发冲突；路由层捕获转 409 `{"error":"task_in_progress","current_task_id":...}` |
| `TaskNotPlayableError(task_id, status)` | 任务不存在或未成功；路由层捕获转 404 |

常量（可被测试 monkeypatch）：

| 常量 | 默认 | 说明 |
|---|---|---|
| `POLL_INTERVAL_SECONDS` | `10.0` | 轮询间隔 |
| `POLL_HARD_TIMEOUT_SECONDS` | `300.0` | 单任务硬超时（DESIGN 非功能性约束） |
| `MAX_CONSECUTIVE_QUERY_FAILURES` | `3` | `ModelVerseError` **连续** 多少次才判任务失败（成功一次清零） |

### 并发模型

- 单进程单事件循环，`in_flight.lock` 强约束并发 = 1
- 非阻塞抢锁：`if lock.locked(): raise ConcurrentTaskError` 否则
  `await lock.acquire()`。**asyncio.Lock 没有 `blocking=False` 参数**，
  threading.Lock 才有；不要混用。FastAPI 单事件循环串行执行 `submit_task`，
  所以 check-then-acquire 不会有 race
- 抢锁后入库失败 → `submit_task` 负责 release 锁，不留死锁
- 后台任务 `_run_orchestration` 的 `finally` 始终清空 `current_task_id` +
  release 锁，未捕获异常也兜底

### 后台编排流程（`_run_orchestration`）

```
try:
    submit_kling_task(prompt, image_base64)
        -> modelverse_task_id
    update_modelverse_id + update_task_status('running')

    loop:
        if elapsed >= 300s:
            update_task_status('failure', error_message='timeout', finished_at=now)
            return
        await asyncio.sleep(10)
        try:
            res = query_kling_task(modelverse_task_id)
            consecutive_failures = 0
        except ModelVerseError as e:
            consecutive_failures += 1
            if consecutive_failures >= 3:
                update_task_status('failure', error_message=str(e), finished_at=now)
                return
            continue
        if res.status == 'success':
            upload_video_from_url(res.video_url, f"videos/{task_id}.mp4")
            update_ufile_key + update_task_status('success', finished_at=now)
            return
        # pending / running → 继续下一轮
except Exception as e:
    update_task_status('failure', error_message=str(e), finished_at=now)
finally:
    in_flight.current_task_id = None
    in_flight.lock.release()
```

注意：`query_kling_task` 在上游 `task_status='Failure'` 时**抛**
`ModelVerseError`（不返回 `status='failure'`）——所以"任务真失败"也走连续
失败计数路径，最迟 ~30 秒后判定。这是 T4 归一化的有意设计：网络抖动 vs
任务真失败在客户端层不区分，统一由上层按连续次数判定，避免误杀。

### 状态机（DESIGN「关键流程 / 提交一个文生视频任务」）

```
pending        -> 入库时（submit_task）
pending → running      -> 成功提交 ModelVerse 后
running → success      -> 轮询到 success + UFile 转存成功
running → failure      -> 轮询到 Failure / 连续 3 次网络失败 / 300s 超时 / 未捕获异常
（提交阶段也可能直接 pending → failure：submit_kling_task 抛 ModelVerseError）
```

## 测试

`backend/tests/test_orchestrator.py` 覆盖 T6 acceptance 两个 case：

- `test_concurrent_submit_raises`：两次并发 `submit_task`，第二次抛
  `ConcurrentTaskError` 且 message 包含当前 in-flight id
- `test_success_path_status_transitions`：mock 成功路径，SQLite 行
  `pending → running → success`，`ufile_object_key` 被填充，锁被释放

外加 `test_get_play_url_for_task_rejects_non_success` 覆盖 404 分支。

运行：

```bash
cd backend
python -m pytest -v
```

测试依赖在 `[project.optional-dependencies].dev`，安装：

```bash
# 项目根执行
uv pip install -e "backend[dev]"
```

## 后续任务衔接

- T7：在 `app/api/tasks.py` 落 `/api/tasks` 路由：
  - `POST /api/tasks` → `submit_task(...)`；捕获 `ConcurrentTaskError` 转 409
  - `GET /api/tasks/{id}/play_url` → `get_play_url_for_task(id)`；捕获
    `TaskNotPlayableError` 转 404
  - 其它读写走 `app.storage.db` 的仓储函数
