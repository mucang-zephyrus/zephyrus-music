# Zephyrus Player · 产品官网（v2）

Vite + Vue 3 + Tailwind CSS v4 构建的单页官网。UI 组件拷贝自 [Inspira UI](https://inspira-ui.com/docs/cn)（MIT）：ParallaxFloat（光标 + 陀螺仪视差）、Marquee、BorderBeam、CardSpotlight、NumberTicker，入场编排使用 GSAP timeline。

- 主叙事：八种播放舞台
- 配色：克莱因蓝 / 电光蓝 / 深蓝 + 黑白灰；大面积渐变灰阶化
- 质感：全面磨砂（backdrop-filter 玻璃拟态，含 `prefers-reduced-transparency` 降级）
- Hero 悬浮件为软件内真实 UI 的 HTML/CSS 实时渲染（迷你播放器 / 状态栏歌词胶囊 / 逐字歌词卡 / 样式设置卡），非截图

## 命令

```bash
npm install
npm run dev      # http://localhost:5273/zephyrus/
npm run build    # 产物在 dist/（base=/zephyrus/）
npm run preview
```

## 部署

`dist/` 上传至服务器 `/var/www/mucang/zephyrus/`（nginx `location /` 静态兜底，线上地址 <https://mucang.xyz/zephyrus/>）。
`credits/` 致谢子页为独立静态目录，原样上传到 `/var/www/mucang/zephyrus/credits`，不参与构建。

## 备注

- `postcss.config.cjs` 为空文件，用于阻断 Vite 向上查找到主仓库的 Tailwind v3 PostCSS 配置。
- 公共图片资产在 `public/`（构建时原样拷贝，线上路径 `/zephyrus/*.png`）。
