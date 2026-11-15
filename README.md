<p align="center">
  <img src="assets/banner-magazine.webp" alt="Zephyrus Music" width="100%" />
</p>

# Zephyrus Music

Zephyrus Music 是面向 Android 手机的音乐播放器，同时提供 Web 版。支持多平台音乐、本地文件、逐字歌词，以及七种不同风格的播放界面。

[![源码版本](https://img.shields.io/badge/source-1.4.2-b48b52)](./package.json)
[![Android](https://img.shields.io/badge/minSdk-24-3ddc84?logo=android&logoColor=white)](./android/variables.gradle)
[![许可证](https://img.shields.io/badge/license-AGPL--3.0-blue)](./LICENSE)

[下载 Android APK](https://mucang.xyz/zephyrus/apks/zephyrus-player-latest.apk) · [打开 Web 版](https://www.mucang.xyz/zephyrus/web/) · [使用文档](https://mucang.xyz/zephyrus/docs/) · [产品官网](https://mucang.xyz/zephyrus/) · [源码仓库](https://github.com/mucang-zephyrus/zephyrus-music)

> 本文介绍开发版功能。Android 安装包与 Web 分别更新，版本变更见[更新日志](./RELEASE_NOTES.md)。

## 七种播放器样式

| 样式 | 主要特点                                       |
| ---- | ---------------------------------------------- |
| 默认 | 大封面与滚动歌词，可选极光、流体和网格渐变背景 |
| 舞台 | 巨幅歌词、逐字砸下、错落排版与鼓点闪白         |
| 星盘 | 旋转圆盘与分块歌词，可调整位置、大小和旋转速度 |
| 词云 | 整曲歌词铺成画布，随演唱显现，镜头跟随当前词句 |
| 点阵 | 圆点或方格组成歌词字形，配合节拍与高潮动画     |
| 烟雾 | 歌曲主题色流体、响度响应、拉伸歌词与高潮暗角   |
| 错误 | 流体、CRT 噪点、溶解歌词与高潮故障效果         |

每种样式分别保存背景、歌词颜色、字体、字重和专属参数。在“播放设置 → 控制 → 样式”选择自定义设置，一键还原可恢复当前样式的默认外观。

错误样式包含强烈闪光，启用前请阅读光敏提示。

## 歌词

支持 TTML、网易云 YRC、QQ QRC、酷狗 KRC、普通与增强 LRC，可显示逐字进度、翻译和罗马音。TTML 还支持背景和声与对唱。

- 在歌词来源设置中调整网易云、QQ、酷狗、社区、LRCLIB 等来源的优先级，也可临时为当前歌曲换源。
- 自有 TTML 与 AMLL TTML 提供社区制作的逐字歌词。
- 点击歌词跳转进度，手动校准时间偏移，选择显示翻译、罗马音或隐藏首尾制作信息。
- 智能整理双语歌词，可按歌曲和来源关闭，并预览、反馈合并问题。

## 音乐与播放

支持网易云、QQ 音乐、酷狗、Zephyrus 云端和本地音乐。搜索页还提供 JOOX、Spotify、B 站等来源筛选，部分来源需要账号或相应服务支持。

在“我的”中添加和切换平台账号。网易云、QQ、酷狗分享链接可粘贴到搜索页，识别歌曲后直接播放。

支持播放队列、定时关闭、播放速度、智能过渡与无缝衔接。关闭后重新打开，可恢复上次歌曲和进度。

动态背景可以随响度与鼓点变化。Web 在线音频的响应能力受跨域限制；iOS Web 可开启防打断模式，该模式会关闭媒体通知与锁屏控制。

## 图片、视频与 AI

将歌曲信息和选中的歌词制成海报，可调整布局、字体、配色、二维码和水印。

视频分享可选择画面比例、时间段、720p 或 1080p，导出 MP4 或 WebM。词云、点阵暂不支持视频导出，其他样式需要设备提供可用编码器。

AI 功能包括歌词解析、AI 歌单等。使用前在设置中选择服务商、填写自己的 API 密钥和模型；请求内容会发送给所选服务商，额度与费用按其规则计算。

## Android 与 Web

| 能力                           | Android            | Web                    |
| ------------------------------ | ------------------ | ---------------------- |
| 在线音乐、播放队列、歌词与样式 | 支持               | 支持                   |
| 本地音乐                       | 授权目录后扫描     | 通过浏览器选择文件     |
| 状态栏悬浮歌词                 | 支持，需悬浮窗权限 | 不支持                 |
| 后台与媒体控制                 | 系统媒体通知       | 由浏览器和操作系统提供 |
| 视频导出                       | 需要可用编码器     | 需要可用编码器         |

当前开发版最低支持 Android 7.0。通知、目录访问和悬浮窗权限可按使用需要授予。

<p align="center">
  <img src="assets/web-desktop.webp" alt="Zephyrus Music Web 桌面界面" width="100%" />
</p>

## 开发

使用 Node.js 22+：

```bash
git clone https://github.com/mucang-zephyrus/zephyrus-music.git
cd zephyrus-music
npm ci
npm run dev:web -- --port 5199 --strictPort
```

环境变量、架构和检查命令见[开发指南](./DEV.md)，Android 签名及发布步骤见[本地构建与服务器发布](./docs/local-workflow.md)。其他技术资料见[维护文档索引](./docs/README.md)。

## 致谢与许可证

本项目基于 [AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) 持续演进，整体以 [AGPL-3.0-only](./LICENSE) 发布。

歌词渲染使用 [Apple Music-like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics)；网格背景的低频驱动曲线参考 [amll-player](https://github.com/JoyElliot/amll-player) 经作者授权的第一方代码。流体效果改编自 [vue-bits](https://github.com/DavidHDev/vue-bits) 的 LiquidEther；词云排版与镜头参考 Folia；点阵使用 Fusion Pixel Font。第三方代码、字体与歌词数据的许可说明见仓库内文件及[致谢站](https://mucang.xyz/zephyrus/credits/)。

使用前请阅读[用户协议](./用户协议.md)。反馈请附上应用版本、设备系统、歌曲平台与 ID、歌词来源、播放器样式及复现步骤。
