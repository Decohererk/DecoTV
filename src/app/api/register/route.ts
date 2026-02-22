/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 验证码存储（简单内存存储，生产环境建议用 Redis）
const captchaStore = new Map<
  string,
  { code: string; expires: number; attempts: number }
>();

// 清理过期验证码
setInterval(() => {
  const now = Date.now();
  captchaStore.forEach((value, key) => {
    if (value.expires < now) {
      captchaStore.delete(key);
    }
  });
}, 60000); // 每分钟清理一次

// 生成验证码
function generateCaptcha(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字符
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 生成 SVG 验证码图片
function generateCaptchaSvg(code: string): string {
  const width = 120;
  const height = 40;
  const fontSize = 24;

  // 随机颜色
  const randomColor = () => {
    const r = Math.floor(Math.random() * 200);
    const g = Math.floor(Math.random() * 200);
    const b = Math.floor(Math.random() * 200);
    return `rgb(${r},${g},${b})`;
  };

  // 随机位置和旋转
  const chars = code.split('').map((char, i) => {
    const x = 15 + i * 25 + (Math.random() - 0.5) * 10;
    const y = 25 + (Math.random() - 0.5) * 5;
    const rotate = (Math.random() - 0.5) * 30;
    const color = randomColor();
    return `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${color}" transform="rotate(${rotate} ${x} ${y})" font-family="Arial, sans-serif" font-weight="bold">${char}</text>`;
  });

  // 干扰线
  const lines = Array.from({ length: 3 }, () => {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    const color = randomColor();
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1" opacity="0.5"/>`;
  });

  // 干扰点
  const dots = Array.from({ length: 30 }, () => {
    const cx = Math.random() * width;
    const cy = Math.random() * height;
    const color = randomColor();
    return `<circle cx="${cx}" cy="${cy}" r="1" fill="${color}"/>`;
  });

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="#f0f0f0"/>
      ${lines.join('')}
      ${dots.join('')}
      ${chars.join('')}
    </svg>
  `;
}

// 验证用户名格式
function validateUsername(username: string): string | null {
  if (!username || username.length < 3) {
    return '用户名至少3个字符';
  }
  if (username.length > 20) {
    return '用户名最多20个字符';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return '用户名只能包含字母、数字和下划线';
  }
  if (/^\d+$/.test(username)) {
    return '用户名不能全是数字';
  }
  // 禁止的用户名
  const forbidden = [
    'admin',
    'root',
    'administrator',
    'system',
    'owner',
    'test',
    'guest',
  ];
  if (forbidden.includes(username.toLowerCase())) {
    return '该用户名不可用';
  }
  return null;
}

// 验证密码强度
function validatePassword(password: string): string | null {
  if (!password || password.length < 6) {
    return '密码至少6个字符';
  }
  if (password.length > 50) {
    return '密码最多50个字符';
  }
  if (/^\d+$/.test(password)) {
    return '密码不能全是数字';
  }
  return null;
}

// GET: 获取验证码
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'captcha') {
      // 生成验证码
      const code = generateCaptcha();
      const sessionId = Math.random().toString(36).substring(2, 15);

      // 存储验证码（5分钟有效期）
      captchaStore.set(sessionId, {
        code,
        expires: Date.now() + 5 * 60 * 1000,
        attempts: 0,
      });

      // 生成 SVG 图片
      const svg = generateCaptchaSvg(code);

      // 返回 SVG 和 sessionId
      return new NextResponse(
        JSON.stringify({
          svg,
          sessionId,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        },
      );
    }

    return NextResponse.json({ error: '无效的请求' }, { status: 400 });
  } catch (error) {
    console.error('获取验证码失败:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// POST: 注册用户
export async function POST(req: NextRequest) {
  try {
    // 检查是否启用注册功能
    const registrationEnabled =
      process.env.NEXT_PUBLIC_ENABLE_REGISTRATION === 'true';
    if (!registrationEnabled) {
      return NextResponse.json({ error: '注册功能未开启' }, { status: 403 });
    }

    // 检查存储类型（localstorage 不支持多用户）
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '当前存储模式不支持用户注册，请使用 Redis/Upstash/Kvrocks' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { username, password, confirmPassword, captcha, sessionId } = body;

    // 验证必填字段
    if (!username || !password || !confirmPassword || !captcha || !sessionId) {
      return NextResponse.json({ error: '请填写完整信息' }, { status: 400 });
    }

    // 验证码检查
    const captchaData = captchaStore.get(sessionId);
    if (!captchaData) {
      return NextResponse.json(
        { error: '验证码已过期，请刷新' },
        { status: 400 },
      );
    }

    // 检查验证码尝试次数（防暴力破解）
    if (captchaData.attempts >= 5) {
      captchaStore.delete(sessionId);
      return NextResponse.json(
        { error: '验证码错误次数过多，请重新获取' },
        { status: 400 },
      );
    }

    // 验证码比对（不区分大小写）
    if (captchaData.code.toLowerCase() !== captcha.toLowerCase()) {
      captchaData.attempts += 1;
      return NextResponse.json(
        { error: '验证码错误，请重试' },
        { status: 400 },
      );
    }

    // 验证码正确，删除使用过的验证码
    captchaStore.delete(sessionId);

    // 验证用户名格式
    const usernameError = validateUsername(username);
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 });
    }

    // 验证密码格式
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // 验证密码确认
    if (password !== confirmPassword) {
      return NextResponse.json({ error: '两次密码不一致' }, { status: 400 });
    }

    // 检查用户名是否已存在
    const exists = await db.checkUserExist(username);
    if (exists) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 400 });
    }

    // 注册用户到数据库
    await db.registerUser(username, password);

    // 获取配置并添加到用户列表
    const config = await getConfig();

    // 检查是否已在配置中（理论上不应该存在）
    const existsInConfig = config.UserConfig.Users.some(
      (u) => u.username === username,
    );

    if (!existsInConfig) {
      // 获取默认用户组设置
      const defaultUserGroup = process.env.DEFAULT_REGISTRATION_GROUP?.trim();

      // 验证默认用户组是否存在于配置中
      let validDefaultGroup: string | undefined;
      if (defaultUserGroup && config.UserConfig.Tags) {
        const groupExists = config.UserConfig.Tags.some(
          (tag) => tag.name === defaultUserGroup,
        );
        if (groupExists) {
          validDefaultGroup = defaultUserGroup;
        } else {
          console.warn(
            `默认注册用户组 "${defaultUserGroup}" 不存在，将不分配用户组`,
          );
        }
      }

      // 构建新用户对象
      const newUser: {
        username: string;
        role: 'user';
        banned: boolean;
        tags?: string[];
      } = {
        username,
        role: 'user', // 新注册用户默认为普通用户
        banned: false,
      };

      // 如果有有效的默认用户组，添加到 tags
      if (validDefaultGroup) {
        newUser.tags = [validDefaultGroup];
        console.log(
          `新用户 "${username}" 已分配到默认用户组: ${validDefaultGroup}`,
        );
      }

      // 添加到用户配置
      config.UserConfig.Users.push(newUser);

      // 保存配置
      try {
        await persistAdminConfigMutation(config);
      } catch (error) {
        console.error('保存用户配置异常:', error);
        // 不影响注册流程
      }
    }

    console.log(`新用户注册成功: ${username}`);

    return NextResponse.json({
      ok: true,
      message: '注册成功！正在跳转登录...',
    });
  } catch (error) {
    console.error('注册失败:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '注册失败，请稍后重试',
      },
      { status: 500 },
    );
  }
}
