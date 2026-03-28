# Claude / Codex / Copilot History Viewer

浏览、搜索、管理本机 AI 编程会话历史的本地工具。

当前已支持：
- Claude Code
- Codex
- GitHub Copilot Chat（VS Code）
- Cursor（优先读取 `globalStorage/state.vscdb`，并结合 `agent-transcripts` / `workspaceStorage/state.vscdb` 兜底）

项目最初只支持 Claude，现已扩展为多来源统一扫描、统一解析、统一展示。

## 功能概览

- 会话列表浏览，支持分页、排序、搜索
- 来源切换：`All / Claude / Codex / Copilot`
- 会话详情查看，支持 Markdown、代码高亮、Thinking、工具调用、引用块
- AskUserQuestion 展示，支持问题、选项、答案、注释
- 全文搜索
- 标签管理
- 收藏切换
- 标题自定义
- Markdown / JSON 导出
- 统计页
- 本地文件变化监听，新增或变更会话后自动入库

## 当前支持的数据来源

### 1. Claude Code

默认扫描目录：

```text
~/.claude/projects
```

兼容内容：
- `sessions-index.json`
- 项目目录下的 `.jsonl` 会话文件
- UUID 会话 ID
- `agent-*` 形式会话 ID
- AskUserQuestion 结果回填
- `subagents` 子代理会话解析

### 2. Codex

默认扫描目录：

```text
~/.codex/sessions
~/.codex/session_index.jsonl
```

兼容格式：
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

写入数据库时会统一加前缀，避免与其他来源冲突：

```text
codex-<raw-session-id>
```

### 3. GitHub Copilot Chat（VS Code）

默认扫描目录：

```text
%APPDATA%/Code/User/workspaceStorage/*/chatSessions/*.json
```

当前能力：
- 解析用户请求与助手回复
- 回退工作区路径
- 统一归类为 `Copilot`
- 宿主标签显示为 `Code`

会话 ID 形式：

```text
copilot-code-<raw-session-id>
```

### 4. Cursor

Cursor 不是按“每会话一个 JSON 文件”存储，而是分散在 SQLite 和 Cursor 自有目录中。

当前读取优先级：

1. `Cursor/User/globalStorage/state.vscdb::composer:<id>`
2. `~/.cursor/projects/*/agent-transcripts/*.jsonl`
3. `Cursor/User/workspaceStorage/*/state.vscdb`

当前能力：
- 优先解析全局 composer 级会话
- 读取用户消息、助手正文、thinking、时间戳
- 读取工具调用与工具结果
- 提取工作区、文件引用
- transcript 与 workspace 状态作为兜底来源
- 统一归类为 `Copilot`
- 宿主标签显示为 `Cursor`

会话 ID 形式：

```text
copilot-cursor-<composer-id>
copilot-cursor-<workspace-id>
```

说明：
- 当前版本优先保证“内容尽量完整”
- Cursor 的一些专有结构仍然是原始结果块展示，后续可再做结构化 UI

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
- 当前统一写入一个 SQLite 数据库
- Claude / Codex / Copilot / Cursor 会话索引都在这里
- 统计缓存默认在 `~/.claude/stats-cache.json`

## 启动方式

### 方式 1：命令行

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

仅后端：

```bash
npm run dev:server
```

仅前端：

```bash
npm run dev:client
```

构建：

```bash
npm run build
```

预览：

```bash
npm run preview
```

### 方式 2：双击 `start.bat`

适合 Windows 本地直接启动。

当前行为：
- 不依赖绝对路径
- 基于脚本所在目录启动
- 自动检查 `package.json`
- 自动检查 `npm`
- 首次缺少 `node_modules` 时自动执行 `npm install`
- 自动寻找可用前端端口
- 启动后自动打开浏览器
- 打开的地址与实际前端端口保持一致

默认端口：

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 Vite | `5173` 起 | 被占用时自动递增 |
| 后端 Express | `3847` | API 服务 |

## 启动后的后台流程

服务启动后，后端会依次执行：

1. 初始化 SQLite 数据库
2. 规范化已有 `summary` / `first_prompt`
3. 回填缺失标题
4. 扫描 Claude / Codex / Copilot / Cursor
5. 启动文件监听
6. 后台构建全文索引

这意味着：
- 页面会先可用，再逐步补全索引和统计
- 第一次扫描较多历史时，搜索结果会稍后完整

## 前端展示说明

### 首页

支持：
- 搜索
- 来源切换
- 项目筛选
- 模型筛选
- Token 区间筛选
- 排序
- 收藏筛选

会话卡片与详情页都会显示来源徽标。
对于 Copilot，还会额外显示宿主标签：
- `Code`
- `Cursor`

### 会话详情页

支持：
- Markdown 渲染
- 代码块高亮
- Thinking 展示
- 工具调用展示
- AskUserQuestion 卡片展示
- 引用块展示
- 收藏切换
- 标题编辑
- 导出 Markdown / JSON

当前 Cursor 详情页已支持：
- 用户消息
- 助手消息
- thinking
- 工具调用
- 工具结果
- 工作区 / 文件引用

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

## 最近完成的兼容性修复

- `start.bat` 去绝对路径，支持任意目录启动
- 首次启动自动 `npm install`
- 前端端口不再写死 `5173`
- 修复部分 Windows 下 `cmd /k` 路径解析问题
- 修复 Claude `agent-*` 会话被误判为非法 ID
- 修复代码块被渲染成 `[object Object]`
- 新增 Codex 新旧格式兼容
- 新增 VS Code Copilot 会话支持
- 新增 Cursor 会话支持
- Cursor 现已支持工具调用 / 工具结果进入消息流
- 全文索引已纳入工具输入、工具结果、引用路径

## 当前已知现状

- Cursor 已能读到较完整正文，但部分工具结果仍以原始文本块显示
- Cursor 的更多专有结构还可以继续细化展示
- Copilot / Cursor 的模型字段不一定稳定存在，因此前端展示对模型做了宽松处理
- 某些旧历史数据本身编码异常时，原始文本可能仍会包含异常字符

## 排障

### 1. 双击 `start.bat` 后打不开

优先检查：
- 是否已安装 Node.js
- `npm` 是否已加入 PATH
- 首次 `npm install` 是否成功
- 黑窗里是否有端口占用或依赖错误

### 2. 页面显示 `Invalid session ID`

当前版本已兼容：
- Claude UUID
- Claude `agent-*`
- Codex `codex-*`
- Copilot `copilot-*`

如果仍出现，通常是后端进程还没重启。

### 3. Copilot / Cursor 会话没出现

优先检查：
- 对应目录是否存在
- 是否已重启后端触发重新扫描
- Cursor 当前会话是否真的落到了本地存储

### 4. 搜索搜不到最新会话内容

优先检查：
- 后端是否完成本轮扫描
- 索引是否已完成构建
- 新改动后的服务是否已重启

## 后续开发建议

如果继续扩展，建议优先做：

- 把 Cursor 常见工具结果做结构化展示
- 把 Cursor 的更多元数据块做更贴近原生的 UI
- 继续增强来源维度统计
- 将扫描器与解析器按来源进一步模块化

## License

当前仓库未单独声明许可证；如需开源或分发，建议补充明确的 LICENSE 文件。
