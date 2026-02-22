<!-- markdownlint-disable MD033 MD026 MD034 -->

<h1 align="center">
  <img src="public/logo.png" alt="DecoTV Logo" width="160" style="margin-bottom: 12px;" />
  <br />
  DecoTV
</h1>

> 🎬 **DecoTV** 是一个开箱即用的、跨平台的影视聚合播放器。它基于 **Next.js 16** + **Tailwind&nbsp;CSS 4** + **TypeScript 5** 构建，支持多资源搜索、在线播放、收藏同步、播放记录、云端存储，让你可以随时随地畅享海量免费影视内容。**支持本地无数据库模式、CMS 全量代理、隐私纵深防御等企业级特性。**

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## 🎬 项目展示

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="public/screenshot1.png" alt="明亮模式" width="400">
        <br>
        <sub><b>明亮模式</b></sub>
      </td>
      <td align="center">
        <img src="public/screenshot2.png" alt="暗夜模式" width="400">
        <br>
        <sub><b>暗夜模式</b></sub>
      </td>
    </tr>
  </table>
</div>

---

### ⚠️ 重要提醒

> **注意**：部署后项目为空壳项目，无内置播放源和直播源，需要自行收集配置。  
> **免责声明**：请不要在 B 站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何"科技周刊/月刊"类项目或站点收录本项目。

## ✨ 功能特性

- 🔍 **多源聚合搜索**：一次搜索立刻返回全源结果。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- 🖥️ **网页投屏（Google Cast）**：支持在网页端直接发起投屏，并提供 iOS 设备兼容提示。
- ❤️ **收藏 + 继续观看**：支持 Kvrocks/Redis/Upstash 存储，多端同步进度。
- 👤 **用户注册系统**：支持用户自助注册（可选），带图形验证码防机器人。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸。
- 📺 **弹幕功能**：集成弹弹play弹幕库，官方镜像开箱即用，支持模糊匹配优化、手动匹配与多节点自定义配置。
- ☁️ **PanSou 网盘搜索**：支持对接远程 PanSou 节点，提供聚合网盘搜索能力，并可在后台灵活配置节点与鉴权。
- ⬇️ **视频资源下载能力**：支持浏览器分片下载与服务端 FFmpeg 转存下载，增强任务管理、重试与超时处理。
- 📡 **灵活直播体验**：支持多直播源配置、分页切换优化与 m3u8/flv/mp4 自动识别处理。
- 🧠 **豆瓣信息增强**：支持标题反查豆瓣 ID、并行抓取与图片代理，详情页信息更完整。
- 👿 **智能去广告**：自动跳过视频中的切片广告（实验性）。
- 🏠 **本地无数据库模式**：无需 Redis，自动降级为浏览器 localStorage 存储。
- 🌐 **CMS 全量代理**：根绝 Mixed Content 和 CORS 问题，支持任意第三方源。
- 🛡️ **隐私纵深防御**：双重熔断机制，从配置到代理层隔离成人内容。

### 注意：部署后项目为空壳项目，无内置播放源和直播源，需要自行收集

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot2.png" alt="项目截图" style="max-width:600px">
</details>

### 请不要在 B 站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何“科技周刊/月刊”类项目或站点收录本项目。

## 🗺 目录

- [🎬 项目展示](#-项目展示)
- [✨ 功能特性](#-功能特性)
- [🛠 技术栈](#-技术栈)
- [🚀 部署](#-部署)
- [⚙️ 配置文件](#️-配置文件)
- [🔄 自动更新](#-自动更新)
- [🌍 环境变量](#-环境变量)
- [⬇️ 下载功能使用指南](#️-下载功能使用指南)
- [Roadmap](#roadmap)
- [📺 AndroidTV 使用](#-androidtv-使用)
- [🔒 安全与隐私提醒](#-安全与隐私提醒)
- [📄 License](#-license)
- [🙏 致谢](#-致谢)
- [📈 Star History](#-star-history)
- [💝 赞赏支持](#-赞赏支持)

## 🛠 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 16](https://nextjs.org/) · App Router · Turbopack                                            |
| UI & 样式 | [Tailwind&nbsp;CSS 4](https://tailwindcss.com/)                                                       |
| 语言      | TypeScript 5                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint 9 · Prettier 3 · Jest 29                                                                       |
| 部署      | Docker                                                                                                |

## 🚀 部署

本项目**仅支持 Docker 或其他基于 Docker 的平台** 部署。

### 🧩 OpenWrt 部署

如果你计划运行在 OpenWrt（软路由 / ARM 盒子 / 树莓派等）设备上，参阅完整指南：

👉 [OpenWrt 部署指南](./docs/OpenWrt部署指南.md)

快速拉取预构建镜像：

```bash
docker pull ghcr.io/decohererk/decotv:latest
```

若需在外部主机自行构建后再导入至 OpenWrt，请参考指南中的 “获取或构建镜像” 与 “导出并传输” 步骤。

### 📦 Docker 镜像标签

DecoTV 提供以下 Docker 镜像标签：

| 标签     | 说明         | 使用场景                         |
| -------- | ------------ | -------------------------------- |
| `latest` | 最新构建版本 | 总是使用最新代码，包含所有小更新 |
| `v1.0.0` | 特定版本号   | 固定版本部署，便于版本管理和回滚 |

**推荐使用方式**：

```bash
# 方式1：使用 latest 标签（自动获取最新更新）
docker pull ghcr.io/decohererk/decotv:latest

# 方式2：使用特定版本号（生产环境推荐）
docker pull ghcr.io/decohererk/decotv:v1.0.0

# 方式3：回滚到旧版本
docker pull ghcr.io/decohererk/decotv:v0.9.0
```

**版本号标签优势**：

- ✅ 清楚知道运行的版本，方便对比 GitHub 最新版
- ✅ 可以固定版本号，避免意外更新影响生产环境
- ✅ 支持版本回滚，遇到问题可快速恢复到旧版本
- ✅ 便于团队协作时统一环境版本

> **注意**：使用 `latest` 标签时，重启容器不会自动拉取新镜像，需要手动执行 `docker pull` 才能获取更新。使用版本号标签可以明确控制何时更新。

### Kvrocks 存储（推荐）

```yml
services:
  decotv-core:
    image: ghcr.io/decohererk/decotv:latest # 或使用 :v1.0.0 固定版本
    container_name: decotv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://decotv-kvrocks:6666
    networks:
      - decotv-network
    depends_on:
      - decotv-kvrocks
  decotv-kvrocks:
    image: apache/kvrocks
    container_name: decotv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks
    networks:
      - decotv-network
networks:
  decotv-network:
    driver: bridge
volumes:
  kvrocks-data:
```

### Redis 存储（有一定的丢数据风险）

```yml
services:
  decotv-core:
    image: ghcr.io/decohererk/decotv:latest # 或使用 :v1.0.0 固定版本
    container_name: decotv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://decotv-redis:6379
    networks:
      - decotv-network
    depends_on:
      - decotv-redis
  decotv-redis:
    image: redis:alpine
    container_name: decotv-redis
    restart: unless-stopped
    networks:
      - decotv-network
    # 请开启持久化，否则升级/重启后数据丢失
    volumes:
      - ./data:/data
networks:
  decotv-network:
    driver: bridge
```

### Upstash 存储

1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 使用如下 docker compose

```yml
services:
  decotv-core:
    image: ghcr.io/decohererk/decotv:latest # 或使用 :v1.0.0 固定版本
    container_name: decotv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=upstash
      - UPSTASH_URL=上面 https 开头的 HTTPS ENDPOINT
      - UPSTASH_TOKEN=上面的 TOKEN
```

### 🏠 本地无数据库模式（最简部署）

如果你只是想**快速体验**或**单机使用**，不需要多端同步功能，可以使用本地存储模式。此模式下数据保存在浏览器的 localStorage 中，无需任何外部数据库。

#### Docker Run（最简单）

```bash
docker run -d \
  --name decotv \
  -p 3000:3000 \
  -e PASSWORD=你的管理密码 \
  ghcr.io/decohererk/decotv:latest
```

#### Docker Compose

```yml
services:
  decotv:
    image: ghcr.io/decohererk/decotv:latest
    container_name: decotv
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=你的管理密码
```

#### 重要说明

| 项目        | 说明                                                                 |
| ----------- | -------------------------------------------------------------------- |
| ✅ 必需配置 | `PASSWORD` - 管理员登录密码                                          |
| ❌ 不需要   | `USERNAME`、`NEXT_PUBLIC_STORAGE_TYPE`、任何数据库连接变量           |
| ❌ 不需要   | `AUTH_SECRET`、`AUTH_URL`（这些是其他认证框架的配置，DecoTV 不使用） |
| ⚠️ 数据存储 | 所有配置保存在浏览器 localStorage，清除浏览器数据会丢失配置          |
| ⚠️ 多端同步 | 不支持，每个浏览器独立存储                                           |

#### 常见问题

**Q: 登录成功后操作仍提示 401 Unauthorized？**

这可能是以下原因：

1. **浏览器 Cookie 问题**：尝试清除浏览器 Cookie 后重新登录
2. **残留数据库配置**：确保没有设置 `REDIS_URL`、`KV_REST_API_URL` 等数据库变量
3. **使用了 HTTPS 代理**：如果你通过 Nginx 等反向代理使用 HTTPS，确保正确配置了 `X-Forwarded-Proto` 头

**Q: 如何从本地模式迁移到数据库模式？**

由于本地模式数据存储在浏览器中，无法直接迁移。建议：

1. 手动导出配置（复制配置文件内容）
2. 部署新的数据库模式实例
3. 在新实例中导入配置

## ⚙️ 配置文件

完成部署后为空壳应用，无播放源，需要站长在管理后台的配置文件设置中填写配置文件（后续会支持订阅）

配置文件示例如下：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://xxx.com/api.php/provide/vod",
      "name": "示例资源",
      "detail": "http://xxx.com"
    }
    // ...更多站点
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。
- `custom_category`：自定义分类配置，用于在导航中添加个性化的影视分类。以 type + query 作为唯一标识。支持以下字段：
  - `name`：分类显示名称（可选，如不提供则使用 query 作为显示名）
  - `type`：分类类型，支持 `movie`（电影）或 `tv`（电视剧）
  - `query`：搜索关键词，用于在豆瓣 API 中搜索相关内容

custom_category 支持的自定义分类已知如下：

- movie：热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈
- tv：热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片

也可输入如 "哈利波特" 效果等同于豆瓣搜索

DecoTV 支持标准的苹果 CMS V10 API 格式。

## 🔄 自动更新

可借助 [watchtower](https://github.com/containrrr/watchtower) 自动更新镜像容器

dockge/komodo 等 docker compose UI 也有自动更新功能

## 🌍 环境变量

### 基础配置

| 变量                  | 说明       | 可选值                   | 默认值                                                                                                                     |
| --------------------- | ---------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| USERNAME              | 管理员账号 | 任意字符串               | 无默认，数据库模式**必填**，本地模式可省略                                                                                 |
| PASSWORD              | 管理员密码 | 任意字符串               | 无默认，**必填**                                                                                                           |
| SITE_BASE             | 站点 URL   | 形如 https://example.com | 空                                                                                                                         |
| NEXT_PUBLIC_SITE_NAME | 站点名称   | 任意字符串               | DecoTV                                                                                                                     |
| ANNOUNCEMENT          | 站点公告   | 任意字符串               | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |

### 存储配置

| 变量                     | 说明                    | 可选值                                | 默认值       | 备注                               |
| ------------------------ | ----------------------- | ------------------------------------- | ------------ | ---------------------------------- |
| NEXT_PUBLIC_STORAGE_TYPE | 存储类型                | localstorage、redis、kvrocks、upstash | localstorage | 不填则默认本地模式，数据存浏览器中 |
| KVROCKS_URL              | Kvrocks 数据库连接地址  | redis://host:port                     | 空           | 当 STORAGE_TYPE=kvrocks 时必填     |
| REDIS_URL                | Redis 数据库连接地址    | redis://host:port                     | 空           | 当 STORAGE_TYPE=redis 时必填       |
| UPSTASH_URL              | Upstash Redis REST URL  | https://xxx.upstash.io                | 空           | 当 STORAGE_TYPE=upstash 时必填     |
| UPSTASH_TOKEN            | Upstash Redis REST 令牌 | AUxxxx...                             | 空           | 当 STORAGE_TYPE=upstash 时必填     |

> **注意**：Upstash 使用 REST API 连接，需要填写 `UPSTASH_URL`（HTTPS ENDPOINT）和 `UPSTASH_TOKEN`，不是传统的 Redis 连接字符串。

### 用户注册配置

| 变量                            | 说明                     | 可选值     | 默认值 | 备注                                             |
| ------------------------------- | ------------------------ | ---------- | ------ | ------------------------------------------------ |
| NEXT_PUBLIC_ENABLE_REGISTRATION | 是否开启用户注册         | true/false | false  | 开启后用户可以自助注册，建议用完即关             |
| DEFAULT_REGISTRATION_GROUP      | 注册用户默认分配的用户组 | 用户组名称 | 空     | 需先在管理面板创建对应用户组，为空则不分配用户组 |

> **安全提示**：注册功能默认关闭，仅在需要时临时开启。建议注册完成后立即设置为 `false` 或删除该变量。详见 [用户注册功能说明](./docs/用户注册功能说明.md)

### 高级配置

| 变量                                | 说明                     | 可选值     | 默认值 | 备注            |
| ----------------------------------- | ------------------------ | ---------- | ------ | --------------- |
| NEXT_PUBLIC_SEARCH_MAX_PAGE         | 搜索接口可拉取的最大页数 | 1-50       | 5      | 数值越大越慢    |
| NEXT_PUBLIC_DOUBAN_PROXY_TYPE       | 豆瓣数据源请求方式       | 见下方说明 | direct | -               |
| NEXT_PUBLIC_DOUBAN_PROXY            | 自定义豆瓣数据代理 URL   | URL prefix | 空     | custom 模式使用 |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE | 豆瓣图片代理类型         | 见下方说明 | direct | -               |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY      | 自定义豆瓣图片代理 URL   | URL prefix | 空     | custom 模式使用 |
| NEXT_PUBLIC_DISABLE_YELLOW_FILTER   | 关闭色情内容过滤         | true/false | false  | 不建议开启      |
| NEXT_PUBLIC_FLUID_SEARCH            | 是否开启搜索接口流式输出 | true/false | true   | -               |

#### NEXT_PUBLIC_DOUBAN_PROXY_TYPE 可选值

| 值                    | 说明                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| direct                | 服务器直接请求豆瓣源站（默认）                                                     |
| cors-proxy-zwei       | 浏览器通过 [Zwei](https://github.com/bestzwei) 提供的 CORS Proxy 请求豆瓣数据      |
| cmliussss-cdn-tencent | 浏览器通过 [CMLiussss](https://github.com/cmliu) 提供的腾讯云 CDN 加速请求豆瓣数据 |
| cmliussss-cdn-ali     | 浏览器通过 [CMLiussss](https://github.com/cmliu) 提供的阿里云 CDN 加速请求豆瓣数据 |
| custom                | 使用自定义代理（需配置 NEXT_PUBLIC_DOUBAN_PROXY）                                  |

#### NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE 可选值

| 值                    | 说明                                                        |
| --------------------- | ----------------------------------------------------------- |
| direct                | 浏览器直接请求豆瓣图片域名（默认）                          |
| server                | 服务器代理请求豆瓣图片                                      |
| img3                  | 使用豆瓣官方精品 CDN（阿里云）                              |
| cmliussss-cdn-tencent | 使用 [CMLiussss](https://github.com/cmliu) 提供的腾讯云 CDN |
| cmliussss-cdn-ali     | 使用 [CMLiussss](https://github.com/cmliu) 提供的阿里云 CDN |
| custom                | 使用自定义代理（需配置 NEXT_PUBLIC_DOUBAN_IMAGE_PROXY）     |

### 弹幕功能配置

DecoTV 集成了 [弹弹play开放平台](https://www.dandanplay.com/) 提供的弹幕库，让您在观看视频时享受弹幕互动体验。

**🎉 开箱即用**：官方 Docker 镜像已内置弹幕服务凭证，无需任何配置即可使用弹幕功能。

> 感谢 [弹弹play](https://www.dandanplay.com/) 为 DecoTV 提供弹幕服务支持！

### 网盘搜索（PanSou）配置

DecoTV 的网盘搜索采用远程 PanSou 节点转发模式。推荐先部署 [fish2018/pansou](https://github.com/fish2018/pansou)，确认服务可访问后，在后台 `PanSou 配置` 中填入服务地址（可选填写 Token）。

快速示例：

1. 部署 PanSou 服务并确保 `https://your-pansou-domain/api/health` 可访问。
2. 进入 DecoTV 后台 `PanSou 配置` 页面。
3. 填写服务地址（例如 `https://your-pansou-domain`），按需填写 `API Token / 鉴权密钥`。
4. 先执行连通性测试，再保存配置即可生效。

## ⬇️ 下载功能使用指南

### 1) 下载当前集（浏览器分片下载）

- 在播放页点击 `下载当前集`。
- m3u8 资源会自动解析分片并下载，完成后在浏览器本地合并导出。
- 该模式不依赖 FFmpeg，适合大部分 Web 部署场景。

### 2) FFmpeg 转存下载（服务端）

- 在播放页点击 `FFmpeg 转存下载`。
- 此模式要求部署环境可执行 `ffmpeg`/`ffprobe`（推荐 Docker/VPS）。
- 在 Vercel 等 Serverless 环境会返回提示：`该功能仅支持 Docker/VPS 部署`。

### 3) 推荐环境与可选变量

- 推荐：Docker / VPS（稳定支持浏览器下载 + FFmpeg 转存）。
- 可选变量：
- `FFMPEG_PATH`：自定义 ffmpeg 可执行路径。
- `FFPROBE_PATH`：自定义 ffprobe 可执行路径。
- `FFMPEG_DOWNLOAD_DIR`：服务端转存文件目录。
- `FFMPEG_ALLOW_SERVERLESS=true`：仅在你明确具备可执行二进制能力时使用。

### 4) 常见错误排查

- `拉取播放列表失败 (502)`：通常是上游 m3u8 源需要特定 `Referer/Origin`，请确认源可访问，或切换其他源重试。
- `FFmpeg API request failed (500/501)`：检查部署环境是否安装 FFmpeg；无二进制能力时请改用 `下载当前集`。

## Roadmap

- [ ] 多语言国际化支持
- [ ] 更多数据库存储选择
- [ ] 手机端 APP 开发
- [ ] 智能推荐算法
- [ ] 用户评分系统
- [x] 弹幕功能（集成弹弹play弹幕库）
- [x] 下载管理（浏览器分片下载 + FFmpeg 转存）

## 📺 AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

已实现播放记录和网页端同步

**详细配置指南**：

- 📖 [OrionTV 使用指南](./docs/OrionTV使用指南.md)
- 🔒 [成人内容过滤使用指南](./docs/成人内容过滤使用指南.md) - **支持通过 URL 参数灵活控制成人内容过滤**

**OrionTV 成人内容过滤快速配置**：

<details>
<summary>点击查看 OrionTV 过滤配置示例</summary>

### 🎯 推荐方式：使用路径前缀

#### 家庭安全模式（推荐家庭使用）

```text
API 地址: https://your-domain.com/
```

✅ 自动过滤成人资源源和敏感关键词

#### 完整内容模式（成人用户）

```text
API 地址: https://your-domain.com/adult/
```

✅ 显示所有内容（包括成人资源）

> 💡 **工作原理**:
>
> - 路径前缀 `/adult/` 会被自动识别并重写
> - 例如: `/adult/api/search` → `/api/search?adult=1`
> - OrionTV 无需额外配置，开箱即用

### 备用方式：使用 URL 参数

**注意**: 此方式仅适用于 Web 端，OrionTV 可能不支持

#### 家庭安全模式

```text
API 地址: https://your-domain.com
```

#### 完整内容模式

```text
API 地址: https://your-domain.com?adult=1
```

详细说明请参阅 [成人内容过滤使用指南](./docs/成人内容过滤使用指南.md)

</details>

## 🎥 TVbox 配置

具体可见 [TVBox 配置优化说明](https://github.com/Decohererk/DecoTV/blob/main/TVBox%E9%85%8D%E7%BD%AE%E4%BC%98%E5%8C%96%E8%AF%B4%E6%98%8E.md) ,详细功能见/admin 管理页面 **TVbox 配置**

## 🧑‍💻 用户注册功能

DecoTV 支持用户自助注册功能（可选），适合需要允许用户自行创建账号的场景。

**功能特性**：

- ✅ 图形验证码防机器人注册
- ✅ 严格的用户名和密码验证
- ✅ 环境变量一键开关（默认关闭）
- ✅ 仅支持 Redis/Upstash/Kvrocks 存储模式

**详细使用指南**：[用户注册功能说明](./docs/用户注册功能说明.md)

**快速启用**：

```bash
# 在环境变量中设置
NEXT_PUBLIC_ENABLE_REGISTRATION=true
NEXT_PUBLIC_STORAGE_TYPE=redis  # 或 upstash、kvrocks
```

> ⚠️ **安全提示**：建议默认关闭注册，仅在需要时临时开启，注册完成后立即关闭。

## 🔒 安全与隐私提醒

### 请设置密码保护并关闭公网注册

为了您的安全和避免潜在的法律风险，我们要求在部署时**强烈建议关闭公网注册**：

### 部署要求

1. **设置环境变量 `PASSWORD`**：为您的实例设置一个强密码
2. **仅供个人使用**：请勿将您的实例链接公开分享或传播
3. **遵守当地法律**：请确保您的使用行为符合当地法律法规

### 重要声明

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任
- 本项目不在中国大陆地区提供服务。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任。特此声明

## 📄 License

[MIT](LICENSE) © 2025 DecoTV & Contributors

## 🙏 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点。

## 📈 Star History

<div align="center">
  <a href="https://star-history.com/#Decohererk/DecoTV&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Decohererk/DecoTV&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Decohererk/DecoTV&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Decohererk/DecoTV&type=Date" />
    </picture>
  </a>
</div>

## 💝 赞赏支持

如果这个项目对你有所帮助，欢迎 Star ⭐ 本项目或请作者喝杯咖啡 ☕

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="public/wechat.jpg" alt="微信赞赏" width="200">
        <br>
        <sub><b>🎨 微信赞赏</b></sub>
      </td>
    </tr>
  </table>
</div>

---

<div align="center">
  <p>
    <strong>🌟 如果觉得项目有用，请点个 Star 支持一下！🌟</strong>
  </p>
  <p>
    <sub>Made with ❤️ by <a href="https://github.com/Decohererk">Decohererk</a> and <a href="https://github.com/Decohererk/DecoTV/graphs/contributors">Contributors</a></sub>
  </p>
</div>
