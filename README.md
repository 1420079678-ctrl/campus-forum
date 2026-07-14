# 嘉大圈 Jiaxing University Student Community

面向嘉兴大学学生的校园社区。打开首页就是内容流，围绕课程学业、校园生活、实习就业、经验问答、闲置集市和社团活动展开；当前不开放教师、学校部门或领导身份，审核员与管理员只负责平台治理。

技术栈：React 19 + Vite（前端） / Express 5 + better-sqlite3（后端） / SQLite 持久化。

## 当前能力

- 桌面端左侧导航、中间高密度信息流、右侧嘉大热榜；手机端底部导航与悬浮发布按钮
- 校园生活站：闲置集市、跑腿互助、失物招领、搭子广场和活动日历，支持场景筛选与预设发布
- 推荐、关注、最新、热度排序，板块、标签、关键词搜索和分页加载
- 校园邮箱验证，验证后发帖、评论、图片上传与私信
- 图文发帖、楼中楼回复、点赞、收藏、关注、公开主页、匿名表达和校园表情包
- 校园热榜、热门话题、活跃同学和社区数据
- 规则审核 + 可选 OpenAI-compatible 模型复核、举报、人工审核和审计日志
- 管理员成员治理与板块管理；审核员只负责内容安全

## 启动、打开与关闭

首次运行先在项目目录安装依赖：

```powershell
npm install
```

开发模式（前端热更新）：

```powershell
npm run dev:all
```

浏览器打开 <http://127.0.0.1:5173>。关闭时回到运行命令的终端，按 `Ctrl + C`；如果终端询问是否终止批处理，输入 `Y` 后回车。

正式构建后运行：

```powershell
npm run build
npm start
```

浏览器打开 <http://127.0.0.1:8787>。关闭同样按 `Ctrl + C`。

> 开发模式会同时占用 5173 和 8787 端口；正式模式只使用 8787。改动 `server/` 后需重启开发命令。

## 创建私有管理员

登录页面不会展示任何演示账号或管理员入口。首次部署时在服务器终端创建管理员：

```powershell
npm run admin:create -- --username jxd_owner --nickname 嘉大圈站长
```

命令会生成一次性随机强密码并显示在当前终端，请立即保存。相同用户名再次运行会重置该管理员密码，并让旧登录会话失效。默认的 `admin` 与 `mod` 演示特权账号会自动停用。

## 配置

复制 `.env.example` 中需要的变量到实际运行环境：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `API_PORT` | `8787` | 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址；局域网访问时设为 `0.0.0.0` |
| `CAMPUS_FORUM_DB` | `./data/campus-forum.db` | SQLite 数据库路径 |
| `CAMPUS_FORUM_UPLOADS` | `./data/uploads` | 帖子图片目录 |
| `CAMPUS_NAME` | `嘉兴大学` | 校园名称 |
| `CAMPUS_EMAIL_DOMAINS` | `zjxu.edu.cn` | 允许验证的校园邮箱域名 |
| `VERIFICATION_WEBHOOK_URL` | 空 | 邮件/短信发送 webhook；开发环境未配置时返回演示验证码 |
| `LLM_MODERATION_URL` | 空 | OpenAI-compatible chat-completions 地址 |
| `LLM_API_KEY` / `LLM_MODEL` | 空 / `gpt-4.1-mini` | 可选真实模型审核配置 |

## 给同学访问

同一校园网或局域网内，可在 PowerShell 运行：

```powershell
npm run build
$env:HOST='0.0.0.0'; npm start
```

用 `ipconfig` 查看电脑 IPv4 地址，把 `http://你的IP:8787` 发给同学。电脑关机或服务停止后网站会下线。

公网长期运行建议使用 Linux 云服务器与 HTTPS：

```bash
npm install
npm run build
HOST=0.0.0.0 npm start
```

也可以直接使用 Docker：

```bash
docker compose up -d --build
docker compose down
```

## 数据与检查

- 数据库位于 `data/campus-forum.db`，上传图片位于 `data/uploads/`
- 备份前先停止服务，再复制整个 `data/` 目录
- 重置演示数据：停止服务后删除 `data/`，重新启动
- 一次运行完整检查：`npm run check`

```text
server/   Express API、业务、数据库与审核
src/      React 页面与组件
tests/    API 集成测试和内容安全测试
docs/     PostgreSQL 迁移与社区规模路线
```

## 能做到什么程度

当前版本已经达到可内测的单校垂直社区形态：信息流、热榜、互动、私信、身份验证、内容治理和后台均可闭环。体验上可以继续向 NodeLoc 的论坛氛围和知乎/贴吧的内容消费效率靠近，但用户规模不是只靠前端就能获得的。

建议先用 100–500 名嘉大学生验证发帖率、次日留存、优质内容供给和举报处理，再逐步加入话题关注、课程/专业知识库、活动报名、闲置交易信用与推荐算法。多实例或多校扩展前，再迁移 PostgreSQL、Redis、对象存储和全文检索。详见 [大学生垂直社区路线](docs/community-scale-roadmap.md) 与 [PostgreSQL 迁移路径](docs/postgresql-migration.md)。
