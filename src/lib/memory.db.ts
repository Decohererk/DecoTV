/* eslint-disable no-console, @typescript-eslint/no-non-null-assertion */

/**
 * 内存存储实现 - 用于本地模式（无 Redis/Upstash/KVRocks）
 *
 * 这个存储将数据保存在服务器进程内存中。
 * 注意：服务器重启后数据会丢失，但配合前端 localStorage 使用时，
 * 前端会在管理页面加载时通过 API 同步配置到后端内存。
 */

import { AdminConfig } from './admin.types';
import {
  Favorite,
  IStorage,
  PlayRecord,
  SkipConfig,
  SkipPreset,
} from './types';

export class MemoryStorage implements IStorage {
  // 使用 Map 存储各类数据
  private playRecords: Map<string, Map<string, PlayRecord>> = new Map();
  private favorites: Map<string, Map<string, Favorite>> = new Map();
  private users: Map<string, string> = new Map(); // username -> password hash
  private searchHistory: Map<string, string[]> = new Map();
  private adminConfig: AdminConfig | null = null;
  private skipConfigs: Map<string, Map<string, SkipConfig>> = new Map();
  private skipPresets: Map<string, SkipPreset[]> = new Map();

  constructor() {
    console.log('[MemoryStorage] 内存存储已初始化（本地模式）');
  }

  // ========== 播放记录 ==========
  async getPlayRecord(
    userName: string,
    key: string,
  ): Promise<PlayRecord | null> {
    const userRecords = this.playRecords.get(userName);
    if (!userRecords) return null;
    return userRecords.get(key) || null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord,
  ): Promise<void> {
    if (!this.playRecords.has(userName)) {
      this.playRecords.set(userName, new Map());
    }
    this.playRecords.get(userName)!.set(key, record);
  }

  async getAllPlayRecords(
    userName: string,
  ): Promise<{ [key: string]: PlayRecord }> {
    const userRecords = this.playRecords.get(userName);
    if (!userRecords) return {};
    const result: { [key: string]: PlayRecord } = {};
    userRecords.forEach((record, key) => {
      result[key] = record;
    });
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    const userRecords = this.playRecords.get(userName);
    if (userRecords) {
      userRecords.delete(key);
    }
  }

  // ========== 收藏 ==========
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const userFavorites = this.favorites.get(userName);
    if (!userFavorites) return null;
    return userFavorites.get(key) || null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite,
  ): Promise<void> {
    if (!this.favorites.has(userName)) {
      this.favorites.set(userName, new Map());
    }
    this.favorites.get(userName)!.set(key, favorite);
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    const userFavorites = this.favorites.get(userName);
    if (!userFavorites) return {};
    const result: { [key: string]: Favorite } = {};
    userFavorites.forEach((favorite, key) => {
      result[key] = favorite;
    });
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    const userFavorites = this.favorites.get(userName);
    if (userFavorites) {
      userFavorites.delete(key);
    }
  }

  // ========== 用户 ==========
  async registerUser(userName: string, password: string): Promise<void> {
    if (this.users.has(userName)) {
      throw new Error('用户已存在');
    }
    this.users.set(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const storedPassword = this.users.get(userName);
    if (!storedPassword) return false;
    return storedPassword === password;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return this.users.has(userName);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    if (!this.users.has(userName)) {
      throw new Error('用户不存在');
    }
    this.users.set(userName, newPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    this.users.delete(userName);
    this.playRecords.delete(userName);
    this.favorites.delete(userName);
    this.searchHistory.delete(userName);
    this.skipConfigs.delete(userName);
    this.skipPresets.delete(userName);
  }

  async getAllUsers(): Promise<string[]> {
    return Array.from(this.users.keys());
  }

  // ========== 搜索历史 ==========
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.searchHistory.get(userName) || [];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    if (!this.searchHistory.has(userName)) {
      this.searchHistory.set(userName, []);
    }
    const history = this.searchHistory.get(userName)!;
    // 去重并添加到开头
    const filtered = history.filter((k) => k !== keyword);
    filtered.unshift(keyword);
    // 保留最近 20 条
    this.searchHistory.set(userName, filtered.slice(0, 20));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    if (keyword) {
      const history = this.searchHistory.get(userName) || [];
      this.searchHistory.set(
        userName,
        history.filter((k) => k !== keyword),
      );
    } else {
      this.searchHistory.delete(userName);
    }
  }

  // ========== 管理员配置 ==========
  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.adminConfig;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    this.adminConfig = config;
    console.log(
      '[MemoryStorage] 管理员配置已更新，视频源数量:',
      config.SourceConfig?.length || 0,
    );
  }

  // ========== 跳过片头片尾配置 ==========
  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    const key = `${source}+${id}`;
    const userConfigs = this.skipConfigs.get(userName);
    if (!userConfigs) return null;
    return userConfigs.get(key) || null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    const key = `${source}+${id}`;
    if (!this.skipConfigs.has(userName)) {
      this.skipConfigs.set(userName, new Map());
    }
    this.skipConfigs.get(userName)!.set(key, config);
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    const key = `${source}+${id}`;
    const userConfigs = this.skipConfigs.get(userName);
    if (userConfigs) {
      userConfigs.delete(key);
    }
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    const userConfigs = this.skipConfigs.get(userName);
    if (!userConfigs) return {};
    const result: { [key: string]: SkipConfig } = {};
    userConfigs.forEach((config, key) => {
      result[key] = config;
    });
    return result;
  }

  async getSkipPresets(userName: string): Promise<SkipPreset[]> {
    const presets = this.skipPresets.get(userName) || [];
    return [...presets];
  }

  async setSkipPresets(userName: string, presets: SkipPreset[]): Promise<void> {
    this.skipPresets.set(userName, [...presets]);
  }

  // ========== 数据清理 ==========
  async clearAllData(): Promise<void> {
    this.playRecords.clear();
    this.favorites.clear();
    this.users.clear();
    this.searchHistory.clear();
    this.adminConfig = null;
    this.skipConfigs.clear();
    this.skipPresets.clear();
    console.log('[MemoryStorage] 所有数据已清空');
  }
}
