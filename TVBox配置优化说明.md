# TVBox 配置优化说明

## 🔐 spider.jar 安全策略变更与迁移指南

### 变更内容

出于供应链安全考虑，**远程 spider.jar 现在默认禁用**。此前版本会自动从内置的第三方源（gitcode.net、gitee.com 等）下载 spider.jar，这意味着部署会静默信任并执行远程二进制代码。现在：

- 默认使用**内置 fallback JAR**（`fallback-only` 模式）。该 JAR 体积极小，仅保证 `/api/spider`、`/api/proxy/spider.jar` 等端点可达、TVBox 体检不报 404，**不包含完整的 CatVod/FongMi spider 功能**。
- 仅当显式配置了远程 URL **并且**提供 SHA-256 校验值时，才会下载远程 JAR（`remote-pinned` 模式）；下载内容哈希不匹配即拒绝使用。

### 对现有用户的影响

如果你的 TVBox / 影视仓配置依赖 CSP 源（Custom Spider Plugin，即需要完整 spider 的站点源），升级后这些源会失效，需要按下面的步骤显式恢复远程 JAR。只使用普通 CMS 采集源的用户不受影响。

### 迁移步骤：恢复远程 spider.jar

1. 选定你信任的 spider.jar 地址（例如 FongMi 发布的 JAR，或你自己托管的副本）。
2. 计算该 JAR 的 SHA-256：

   ```bash
   # Linux / macOS
   curl -fsSL https://你信任的地址/spider.jar | sha256sum

   # Windows PowerShell
   (Get-FileHash .\spider.jar -Algorithm SHA256).Hash
   ```

3. 在部署环境中设置以下环境变量并重启：

   ```bash
   ALLOW_REMOTE_SPIDER_JAR=true
   SPIDER_JAR_URL=https://你信任的地址/spider.jar
   # 多个候选地址可用 SPIDER_JAR_URLS，逗号或空格分隔
   SPIDER_JAR_SHA256=<第 2 步算出的 64 位十六进制哈希>
   ```

4. 验证是否生效：

   ```bash
   # spider_security_mode 应为 remote-pinned，spider_hash_verified 应为 true
   https://你的域名/api/tvbox/spider-status
   https://你的域名/api/tvbox/config?format=json   # 查看 spider_* 字段
   ```

> ⚠️ 三个变量缺一不可：未设置 `SPIDER_JAR_SHA256` 或 URL 时会静默回退到 `fallback-only` 模式。JAR 更新后哈希会变化，需要同步更新 `SPIDER_JAR_SHA256`，否则校验失败同样回退到 fallback。
>
> 说明：`?spider=` 订阅参数现在仅接受已配置的 pinned 候选地址，不再允许指向任意外部 JAR，防止订阅链接被用作开放代理。

## 🎯 针对 SSL handshake 错误和切换体验的优化

### 已完成的关键优化

#### 1. **Spider Jar 优化**

- ✅ **安全供应链**：远程 JAR 默认禁用，启用时强制 SHA-256 校验（见上方迁移指南）
- ✅ **SSL 兼容性**：优化请求头，减少 SSL handshake 错误
- ✅ **同源回退**：内置 fallback JAR 保证端点可达，避免体检 404
- ✅ **连接优化**：使用 `Connection: close` 避免连接复用问题

#### 2. **新增配置模式**

支持多种配置模式，按需选择：

```bash
# 标准模式（默认）
https://你的域名/api/tvbox/config?mode=standard&format=json

# 影视仓优化模式
https://你的域名/api/tvbox/config?mode=yingshicang&format=json

# 快速切换优化模式（新增）
https://你的域名/api/tvbox/config?mode=fast&format=json

# 安全模式（最小配置）
https://你的域名/api/tvbox/config?mode=safe&format=json
```

#### 清晰度过滤

如果电视端搜索结果中低清资源过多，可以在订阅地址加入 `minResolution`：

```text
https://你的域名/api/tvbox/config?minResolution=720&format=json
https://你的域名/api/tvbox/config?minResolution=1080&format=json
```

该参数会透传到 DecoTV 智能搜索代理。默认策略只过滤“已识别且低于门槛”的结果，未知清晰度会保留；如果需要严格过滤未知清晰度，追加：

```text
https://你的域名/api/tvbox/config?minResolution=720&resolutionStrict=1&format=json
```

支持值：`360`、`480`、`720`、`1080`、`1440`、`2160`、`hd`、`fhd`、`2k`、`4k`。

#### 3. **专用 Jar 服务**

新增独立的 jar 服务端点，提升加载成功率：

```bash
# 直接获取优化的 jar 文件
https://你的域名/api/spider

# 强制刷新 jar 缓存
https://你的域名/api/spider?refresh=1
```

### 🚀 推荐使用方案

#### **方案一：影视仓用户**

```
订阅地址：https://你的域名/api/tvbox/config?mode=yingshicang&format=json
```

**特点**：

- ✅ 专门为影视仓优化
- ✅ 简化配置，减少冲突
- ✅ 移动端 UA，提升兼容性
- ✅ 强制启用所有搜索功能

#### **方案二：追求极速切换**

```
订阅地址：https://你的域名/api/tvbox/config?mode=fast&format=json
```

**特点**：

- ⚡ 移除可能导致卡顿的配置
- ⚡ 优化请求头，提升响应速度
- ⚡ 减少首页内容，加快加载
- ⚡ 使用极速解析和并发解析

#### **方案三：标准稳定版**

```
订阅地址：https://你的域名/api/tvbox/config?mode=standard&format=json
```

**特点**：

- 🛡️ 完整功能配置
- 🛡️ 多重容错机制
- 🛡️ 丰富的解析线路
- 🛡️ 适合大部分用户

### 🔧 针对 SSL 错误的解决方案

#### **问题分析**

"SSL handshake aborted" 错误通常由以下原因导致：

1. 网络环境对某些域名的 SSL 连接不稳定
2. jar 文件服务器的 SSL 配置问题
3. 设备或网络的 SSL 协议版本不兼容

#### **解决策略**

1. **同源分发**：spider 主字段默认指向同源端点，避免第三方 jar 源的 SSL 问题
2. **优化请求头**：使用移动端 UA 和优化的请求参数
3. **连接管理**：使用 `Connection: close` 避免连接复用问题
4. **智能缓存**：成功的 jar 缓存 4 小时，减少重复请求

### 📱 使用建议

#### **初次使用**

1. 建议先使用 **影视仓模式** 或 **快速模式**
2. 如果仍有问题，尝试 **安全模式**
3. 体检通过后，根据体验选择合适的模式

#### **遇到切换卡顿**

1. 切换到 **快速模式** (`mode=fast`)
2. 使用专用 jar 服务：在配置中手动指定 `?spider=https://你的域名/api/spider`
3. 定期清理 app 缓存

#### **网络环境不稳定**

1. 使用 **安全模式** (`mode=safe`)
2. 启用强制刷新：`?forceSpiderRefresh=1`
3. 考虑使用国内镜像部署

### 🎉 预期改善效果

- ✅ **SSL 错误大幅减少**：多源策略 + 优化请求头
- ✅ **切换速度提升**：快速模式 + 连接优化
- ✅ **稳定性增强**：智能回退 + 容错机制
- ✅ **兼容性提升**：移动端 UA + 简化配置

### 💡 高级用法

#### **自定义 jar**

```bash
# 使用自定义jar（必须是已通过环境变量配置的 pinned 候选地址之一）
https://你的域名/api/tvbox/config?spider=https://你的jar地址.jar&format=json
```

> 注意：出于安全考虑，`?spider=` 只接受 `SPIDER_JAR_URL` / `SPIDER_JAR_URLS` 中已配置的地址，任意外部地址会被忽略并回退到默认 spider。

#### **调试模式**

```bash
# 查看详细的spider选择信息
https://你的域名/api/tvbox/config?mode=standard&format=json
# 查看返回的 spider_* 字段了解选择过程
```

---

**立即部署，享受优化后的流畅体验！** 🚀
