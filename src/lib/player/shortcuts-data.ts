export interface ShortcutEntry {
  category: string;
  items: { keys: string; description: string }[];
}

export const SHORTCUTS_DATA: ShortcutEntry[] = [
  {
    category: '播放控制',
    items: [
      { keys: 'Space', description: '播放 / 暂停' },
      { keys: '←', description: '快退 10 秒' },
      { keys: '→', description: '快进 10 秒' },
      { keys: '↑', description: '音量增加' },
      { keys: '↓', description: '音量减少' },
      { keys: '长按视频', description: '临时 2.0x 倍速' },
    ],
  },
  {
    category: '画面与显示',
    items: [
      { keys: 'F', description: '切换全屏' },
      { keys: '?', description: '显示快捷键帮助' },
    ],
  },
  {
    category: '剧集导航',
    items: [
      { keys: 'Alt + ←', description: '上一集' },
      { keys: 'Alt + →', description: '下一集' },
    ],
  },
];
