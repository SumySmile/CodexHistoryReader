# Claude / Codex History Viewer

浏览、搜索、管理本机的 AI 编程会话历史。目前已支持：

- Claude Code
- Codex

项目最初只支持 Claude，现已扩展为双数据源读取与展示。后续如果要接入更多来源，建议继续沿用“数据源扫描 + 统一解析 + 统一前端展示”的结构。

## 功能概览

- 会话列表浏览，支持分页、排序、搜索
- 项目维度筛选、收藏筛选、标签筛选
- 会话详情查看，支持 Markdown 渲染、代码高亮、Thinking 展示、工具调用展示
- AskUserQuestion 展示，支持问题、选项、答案、注释信息
- 全文搜索
- 标签管理
- 收藏切换
- 标题自定义
- Markdown / JSON 导出
- 统计页
- 本地文件变更监听，新增或变更会话后自动入库

## 当前支持的数据来源

### 1. Claude Code

默认扫描目录：

```text
~/.claude/projects
```

主要兼容内容：

- `sessions-index.json` 索引
- 项目目录下的 `.jsonl` 会话文件
- UUID 会话 ID
- `agent-xxxxxxx` 形式的会话 ID
- AskUserQuestion 结果回填
- 子代理 `subagents` 会话解析

### 2. Codex

默认扫描目录：

```text
~/.codex/sessions
~/.codex/session_index.jsonl
```

目前兼容两类 Codex 历史格式：

- 旧格式
  - `message`
  - `reasoning`
  - `function_call`
  - `function_call_output`
- 新格式
  - `session_meta`
  - `response_item`
  - `event_msg`
  - `turn_context`

Codex 会话写入数据库时会统一加前缀，避免与 Claude 的会话 ID 冲突：

```text
codex-<raw-session-id>
```

## 技术结构

### 前端

- React 19
- React Router 7
- Vite
- Tailwind CSS 4
- `react-markdown` + `rehype-highlight`
- Recharts

### 后端

- Express
- TypeScript
- better-sqlite3
- chokidar

### 本地数据库

默认数据库文件：

```text
~/.claude/history-viewer.db
```

说明：

- 当前数据库统一落在 `~/.claude` 下
- Claude 与 Codex 的会话索引都写入这一个 SQLite 库
- 统计缓存默认也在 `~/.claude/stats-cache.json`

## 启动方式

### 方式 1：命令行启动

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

仅启动后端：

```bash
npm run dev:server
```

仅启动前端：

```bash
npm run dev:client
```

生产构建：

```bash
npm run build
```

预览构建产物：

```bash
npm run preview
```

### 方式 2：双击 `start.bat`

适合 Windows 本地直接启动。

`start.bat` 当前行为：

- 不依赖绝对路径，始终基于脚本自身目录启动
- 自动检查 `package.json`
- 自动检查 `npm` 是否可用
- 首次启动如果缺少 `node_modules`，会先执行 `npm install`
- 自动寻找可用的前端端口，默认从 `5173` 开始递增
- 在单独的 `cmd` 窗口中启动开发服务
- 等待服务拉起后自动打开浏览器
- 浏览器打开的是实际使用的端口，而不是写死的 `5173`

默认端口：

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 Vite | `5173` 起 | 若被占用会自动递增 |
| 后端 Express | `3847` | API 服务 |

## 启动后的后台流程

服务启动后，后端会按顺序执行：

1. 初始化 SQLite 数据库
2. 规范化历史 `summary` / `first_prompt`
3. 为缺失标题的旧会话回填标题
4. 扫描 Claude 与 Codex 目录并写入会话索引
5. 启动文件监听
6. 延迟执行全文索引构建

这意味着：

- 页面先可用，再逐步补全索引与统计
- 第一次扫描较多历史时，首页数量和搜索结果会逐步完整

## 前端页面

### 首页

支持：

- 搜索
- 项目筛选
- 模型筛选
- Token 区间筛选
- 排序
- 收藏筛选

当前列表已能同时展示 Claude 与 Codex 会话。下一步建议增加更明确的“来源切换”和来源徽标。

### 会话详情页

支持：

- Markdown 渲染
- 代码块高亮
- 代码复制
- Thinking 区块展示
- 工具调用展示
- AskUserQuestion 卡片展示
- 收藏切换
- 标题编辑
- 导出 Markdown / JSON

### 搜索页

支持全文搜索会话内容，并回显命中的片段。

### 统计页

支持查看：

- 总会话数
- 收藏数
- 标签数
- 总消息数
- 模型分布
- 项目分布
- 最近活跃情况

## 后端 API

主要接口：

- `GET /api/sessions`
- `GET /api/sessions/:id/messages`
- `PATCH|POST|PUT /api/sessions/:id/title`
- `PATCH /api/sessions/:id/favorite`
- `GET /api/sessions/:id/export?format=md|json`
- `GET /api/search`
- `GET /api/tags`
- `POST /api/tags`
- `DELETE /api/tags/:id`
- `POST /api/tags/sessions/:sessionId`
- `DELETE /api/tags/sessions/:sessionId/:tagId`
- `GET /api/projects`
- `GET /api/stats`
- `GET /api/models`
- `GET /api/indexing-status`
- `GET /api/events`

## 兼容性修复记录

本次迁移后，已补上的关键兼容修复包括：

- `start.bat` 去绝对路径，支持任意盘符、任意目录启动
- 首次启动自动 `npm install`
- 前端端口不再写死为 `5173`
- 修复部分 Windows 环境下 `cmd /k` 引号解析问题
- 修复 `agent-xxxxxxx` Claude 会话被误判为非法 ID 的问题
- 修复代码块被渲染成 `[object Object]` 的问题
- 新增 Codex 历史会话扫描与解析
- 新增新版 Codex `session_meta` / `response_item` 格式兼容

## 已知现状

- 当前首页虽然已能同时展示 Claude 和 Codex，但来源区分还不够明显
- 目前前端还没有独立的“Claude / Codex”切换入口
- Codex 的展示已可用，但还可以继续做更细的来源化 UI
- 统计与模型名展示仍偏 Claude 风格，后续建议按来源分层处理

## 排障

### 1. 双击 `start.bat` 后页面打不开

优先检查：

- 是否安装了 Node.js
- `npm` 是否已加入 PATH
- 首次 `npm install` 是否成功
- 黑窗里是否有端口占用或依赖报错

### 2. 页面显示 `Invalid session ID`

旧版本后端只接受 UUID。当前版本已兼容：

- Claude UUID
- Claude `agent-*`
- Codex `codex-*`

如果还看到这个错误，通常是后端进程还没重启。

### 3. 会话内容显示 `[object Object]`

这是旧版代码块渲染逻辑和新环境依赖行为不兼容导致的。当前版本已修复。

### 4. Codex 会话没有出现在列表

优先检查：

- `~/.codex/sessions` 是否存在
- 是否已经重启后端触发重新扫描
- 是否是新格式 Codex 会话文件
- 是否被最近大量 Claude 会话挤到后面的分页中

## 开发建议

如果后续继续扩展到更多来源，建议优先做这几件事：

- 在后端返回统一的 `source` 字段，而不是长期依赖会话 ID 前缀判断
- 首页增加 `全部 / Claude / Codex` 来源切换
- 卡片与详情页增加来源徽标
- 模型筛选按来源收敛，避免不同来源模型混在同一个下拉框里

## License

当前仓库未单独声明许可证；如需开源或分发，建议补充明确的 LICENSE 文件。
