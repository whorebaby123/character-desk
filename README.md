# Character Desk · 人物工作台

开源的 SillyTavern 角色卡与世界书创作工作台。可以读取已有设定、生成新设定，参考文本分析人物形象与关系，也可以用游玩反馈和酒馆对话提出局部修订，审核差异后导出 JSON。原先的 ChatGPT Sites 地址不能从本仓库重新发布。请用下面的按钮部署到你自己的免费 Vercel 账号（用 GitHub 登录，不需要信用卡）。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/whorebaby123/character-desk&project-name=character-desk&repository-name=character-desk)

## 使用方式

1. 打开网站，在侧栏新建角色卡或世界书，也可以读取 JSON、PNG 角色卡、TXT 或 Markdown。
2. 在「API 设置」里选择服务商、模型和接口地址，填写自己的密钥并测试连接。也可复制提示词，在其他 AI 中生成，再粘贴结果。IP 或 HTTP 中转见下文。
3. 在「创作与分析」生成设定、研究参考文本或分析游玩问题；审核改动后再应用。
4. 在「编辑设定」修改字段。世界书条目可单独设置触发词，也能请求触发词建议。展开侧栏项目列表后，在某个角色卡或世界书项目名称上**点击右键**，可删除该项目；删除前会再次确认。
5. 导出角色卡或世界书 JSON。项目和历史保存在当前浏览器；换设备前下载项目备份。

创作预设的「自定义创作预设/破甲预设」是可编辑的用户提示词字段；是否接受其内容由你选择的模型服务商决定。

## IP 与 HTTP 中转

公开网站走 HTTPS，但浏览器不会直接访问你的中转节点，因此不存在「HTTPS 页面请求 HTTP 地址」的混合内容拦截。页面只把配置发给本站的 `/api/connection` 和 `/api/generate`，由服务器代为连接。

在「API 设置」选择「自定义 · OpenAI 兼容」。地址可以是下面任意一种：

- `http://1.2.3.4:8080/v1`
- `http://1.2.3.4:8080`（没有路径时自动补上 `/v1`）
- `http://1.2.3.4/v1`
- `https://1.2.3.4:8443/v1`（证书必须是受信任的，并且包含这个 IP；域名证书或自签证书请改用 http，或改用与证书一致的域名）

密钥填在 Key 栏。地址里不要写账号、密码、`?query` 或 `#fragment`。填写 `http://` 时，设置页会提示：密钥从本站服务器到节点的这一段是明文。

公开部署默认拒绝内网、本机和云元数据地址，包括 `127.0.0.1`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.169.254`、`::1`，以及链路本地、共享地址（`100.64.0.0/10`）和文档用保留网段。公开网站的服务器不在你的局域网里，填写 `192.168.x.x` 也访问不到家里的节点，需要一台有公网 IP 或公网域名的中转。

自行部署、并且进程与中转在同一台机器或同一内网时，可以设置环境变量 `ALLOW_PRIVATE_API_HOSTS=1`（或 `true` / `yes`）允许内网和本机地址。云元数据、链路本地、组播和保留网段仍然拒绝。这个开关只有部署者能改，访客不能自己打开。请同时加上身份认证和速率限制；同源检查不等于登录。

Cloudflare Workers 的 `fetch` 不能直接请求 IP。服务器对 IP 字面量改为 TCP 连接，只请求模型列表和生成这两类路径，限制响应体积和 90 秒超时，并且不跟随重定向，避免把密钥转到别的地址。域名仍走 `fetch`。只检查名字本身，不能防止一个公网域名解析到内网地址。

## 部署

新站点放在 [Vercel](https://vercel.com) 的免费 Hobby 计划上：注册就是 **Continue with GitHub**，不需要信用卡。Hobby 上的接口最长可以跑 5 分钟，盖得住这里 90 秒的模型请求。浏览器仍然只访问本站，由服务器去连 `http://公网IP`；在 Vercel 上这条连接走 Node 的普通请求，不依赖 Cloudflare。项目数据只留在浏览器里，部署时不用填模型密钥。

先把本仓库合并进 `main`，然后：

1. 点击上面的 **Deploy with Vercel**。
2. 选择 **Continue with GitHub**，用 GitHub 登录并授权。
3. 确认项目名称，点 **Deploy**。

完成后打开 Vercel 给出的 `https://character-desk-….vercel.app`。在「API 设置」里选择「自定义 · OpenAI 兼容」，填 `http://公网IP:端口/v1`。公开站点不要设置 `ALLOW_PRIVATE_API_HOSTS`。

## 本地开发

需要 Node.js 24、npm 和 Bash（Windows 可用 WSL2）：

```bash
npm ci
npm run dev
```

检查与构建：

```bash
npm run typecheck
npm run test:unit
npm run build
```

源码中的 `.openai/hosting.json` 是原网站的 Sites 项目标识。部署到自己的 Sites 项目时，请换成自己项目的标识；部署到其他平台时按平台需要调整构建与托管方式。项目不会附带 API 密钥，密钥只从当前用户的浏览器请求传入服务端代理。自行公开部署时，应评估身份验证、请求来源和出站访问限制。

更完整的格式映射、使用说明和开发交接见 [使用与开发交接文档](public/handoff.md)。

## 许可证

[MIT](LICENSE)。
