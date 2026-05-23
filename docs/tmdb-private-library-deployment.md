# TMDB 与私人影库部署说明

## 环境变量

- `TMDB_API_KEY`
  - TMDB v3 API Key。未配置时 TMDB 能力会静默降级。
- `TMDB_PROXY`
  - TMDB 正向代理地址，例如 `http://127.0.0.1:7890`。
- `TMDB_REVERSE_PROXY`
  - TMDB 反向代理地址，例如 `https://tmdb.example.com`。
  - 优先级高于 `TMDB_PROXY`。
- `OPENLIST_URL`
  - OpenList 服务地址。
- `OPENLIST_TOKEN`
  - OpenList Token，仅允许保存在服务端环境中。
- `OPENLIST_ROOT_PATH`
  - OpenList 扫描根目录，默认 `/Media`。
- `EMBY_URL`
  - Emby 服务地址。
- `EMBY_API_KEY`
  - Emby API Key。
- `EMBY_USER_ID`
  - Emby 用户 ID，可选，用于播放进度回写。
- `JELLYFIN_URL`
  - Jellyfin 服务地址。
- `JELLYFIN_API_KEY`
  - Jellyfin API Key。
- `JELLYFIN_USER_ID`
  - Jellyfin 用户 ID，可选，用于播放进度回写。

## 部署建议

- Docker 或自托管 Node 环境更适合作为私人影库的正式部署方式。
- 私人影库流代理依赖服务端访问 OpenList / Emby / Jellyfin，请确认容器网络或主机网络能访问这些地址。
- `TMDB_REVERSE_PROXY` 和 `TMDB_PROXY` 至少建议配置一项，以便中国大陆环境稳定访问 TMDB。
- 虽然 `vercel.json` 已设置 `maxDuration: 30`，但 OpenList 大目录扫描仍不适合长期依赖 Vercel Serverless 运行。
- 业务代码默认通过项目内图片代理访问 TMDB 图片，不依赖浏览器直连 TMDB CDN。
