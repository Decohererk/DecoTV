# ---- 第 1 阶段：安装依赖 ----
FROM node:20-alpine AS deps

# 启用 corepack 并激活 pnpm（Node20 默认提供 corepack）
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

WORKDIR /app

# 仅复制依赖清单，提高构建缓存利用率
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 安装所有依赖（含 devDependencies，后续会裁剪）
RUN pnpm install --frozen-lockfile

# ---- 第 2 阶段：构建项目 ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app
ARG BUILD_TIMESTAMP
ARG GIT_COMMIT_SHA
ARG GIT_COMMIT_DATE
ARG GIT_REF_NAME

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
# 复制全部源代码
COPY . .

# 在构建阶段也显式设置 DOCKER_ENV 和 DOCKER_BUILD
ENV DOCKER_ENV=true
ENV DOCKER_BUILD=true
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV GIT_COMMIT_DATE=${GIT_COMMIT_DATE}
ENV GIT_REF_NAME=${GIT_REF_NAME}
ENV NEXT_PUBLIC_BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV NEXT_PUBLIC_BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV NEXT_PUBLIC_BUILD_COMMIT_DATE=${GIT_COMMIT_DATE}
ENV NEXT_PUBLIC_BUILD_REF=${GIT_REF_NAME}

# 生成生产构建
RUN pnpm run build

# ---- 第 3 阶段：生成运行时镜像 ----
FROM node:20-alpine AS runner
ARG BUILD_TIMESTAMP
ARG GIT_COMMIT_SHA
ARG GIT_COMMIT_DATE
ARG GIT_REF_NAME

# 安装运行期 FFmpeg。服务端转存下载依赖 ffmpeg/ffprobe，VPS Docker 镜像需开箱可用。
RUN apk add --no-cache ca-certificates ffmpeg \
  && addgroup -g 1001 -S nodejs \
  && adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DOCKER_ENV=true
ENV FFMPEG_DOWNLOAD_DIR=/app/.cache/ffmpeg-downloads
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV GIT_COMMIT_DATE=${GIT_COMMIT_DATE}
ENV GIT_REF_NAME=${GIT_REF_NAME}
ENV NEXT_PUBLIC_BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV NEXT_PUBLIC_BUILD_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV NEXT_PUBLIC_BUILD_COMMIT_DATE=${GIT_COMMIT_DATE}
ENV NEXT_PUBLIC_BUILD_REF=${GIT_REF_NAME}

# 从构建器中复制 standalone 输出
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 从构建器中复制 scripts 目录
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# 从构建器中复制 start.js
COPY --from=builder --chown=nextjs:nodejs /app/start.js ./start.js
# 从构建器中复制 public 和 .next/static 目录
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 预创建服务端转存目录，确保非 root 用户可写。
RUN mkdir -p /app/.cache/ffmpeg-downloads \
  && chown -R nextjs:nodejs /app/.cache

# 切换到非特权用户
USER nextjs

EXPOSE 3000

# 使用自定义启动脚本，先预加载配置再启动服务器
CMD ["node", "start.js"] 
