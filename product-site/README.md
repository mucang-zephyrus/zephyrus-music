# Zephyrus Player 产品介绍站

此目录是独立的 Vite + Vue 3 + Tailwind CSS v4 单页官网，使用 GSAP 编排动画。部分界面组件来自 Inspira UI，来源和许可按对应文件保留。

播放器功能见[根 README](../README.md)，用户指南在 [website/](../website/)。官网文案维护于 `src/components/site/`。

## 开发与构建

在本目录执行：

```bash
npm ci
npm run dev
npm run build
npm run preview
```

开发端口为 5273，部署基路径为 `/zephyrus/`，构建输出 `dist/`。端口和基路径见 `vite.config.ts`。

## 目录与视觉

- `src/components/site/`：首页各区块与产品文案。
- `src/components/ui-preview/`：用 HTML／CSS 渲染的播放器、歌词和设置示意。
- `src/components/inspira/`：引入的界面组件。
- `public/`：构建时原样复制的公共图片。
- `credits/`：独立静态致谢页，不参与 Vite 构建。

站点使用蓝色、黑白灰与玻璃材质，部分组件支持减少透明度或运动。UI 预览为 HTML／CSS 示意。

## 内容同步

播放器有默认、舞台、星盘、词云、点阵、烟雾、错误七种样式。产品站部分组件仍写有旧的八种舞台文案，需要同步更新 `HeroSection`、`StagesStrip`、`StylesSection` 等组件。

功能说明见 [README](../README.md)，发布步骤见[发布指南](../docs/local-workflow.md)。

## 部署

构建产物对应服务器 `/var/www/mucang/zephyrus/`，对外路径为 `/zephyrus/`。`credits/` 需独立处理；播放器 Web、用户文档和 APK 位于其他子路径，更新官网时应保留这些入口。

本目录的 PostCSS 配置为 `postcss.config.cjs`。
