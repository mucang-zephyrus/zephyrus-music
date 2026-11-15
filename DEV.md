# Zephyrus Music 开发指南

本指南介绍 Android、Web 及 Electron 入口的开发环境、代码结构和检查方法。

## 环境与启动

- Node.js 22+，依赖以根目录 `package-lock.json` 为准。
- 本地工作流需要 Python 3.10+；上传阶段另需 `paramiko`。
- Android 构建使用 JDK 21、Android SDK 36 与 Build Tools 36.0.0。
- `lint:i18n` 的 npm 脚本使用 Bun；未安装 Bun 时可在支持类型剥离的 Node.js 上直接运行同一检查器。

```bash
npm ci
npm run dev:web -- --port 5199 --strictPort
```

音乐 API 服务需单独配置。开发服务器使用 `--strictPort`，端口占用时会直接报错。

`npm run dev` 启动 Electron 开发入口。

## 构建产物

| 命令                                               | 用途与产物                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run build:web`                                | 浏览器前端，输出 `src/renderer/dist/`                               |
| `npm run build`                                    | electron-vite 构建，渲染产物位于 `out/renderer/`，供 Capacitor 使用 |
| `npm run workflow -- web`                          | 歌词测试、工作流测试与 Web 构建                                     |
| `npm run ci:local`                                 | 歌词测试、工作流测试与完整 electron-vite 构建                       |
| `npm run release:android -- --version-code <整数>` | 校验签名、构建、Capacitor 同步、Gradle 与 APK 验证                  |

`capacitor.config.ts` 的 `webDir` 是 `out/renderer`。不能把单独执行 `build:web` 当作 Android 资源已更新。

本地工作流会设置 `VITE_DISABLE_GZIP=1`；手动构建 Web 时可按需要设置该变量以跳过 gzip。它只影响压缩产物，不决定是否部署。

## 环境变量

通过本地 `.env.*.local` 或进程环境覆盖配置。所有 `VITE_*` 值都会进入客户端，不能用来保存服务端密码或签名密钥。

| 变量                    | 用途                                            |
| ----------------------- | ----------------------------------------------- |
| `VITE_API`              | 网易云 API 基础地址；缺失时请求层使用代码内兜底 |
| `VITE_API_MUSIC`        | 音乐解析服务基础地址                            |
| `VITE_MUSIC_GATEWAY`    | 平台登录、分享与其他音乐网关基础地址            |
| `VITE_TTML_DB_BASE_URL` | 自有 TTML 库基础地址，配置后在 AMLL 之前尝试    |
| `VITE_DISABLE_GZIP`     | 值为 `1` 时跳过 Web gzip 构建插件               |

修改构建环境变量后需要重新启动开发服务器或重新构建。AI 密钥在应用设置中配置，不写入构建环境或仓库。

## 代码导航

| 模块             | 入口与职责                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| 应用启动         | `src/renderer/main.ts`：挂载前迁移词云配置、应用背景健康保险丝，注册深链                      |
| 布局与导航       | `layout/MobileLayout.vue`、`router/`，以及 Dock、页面手势相关 composables                     |
| 播放状态         | `store/modules/player.ts` 聚合 `playerCore`、`playlist`、收藏、历史与定时关闭                 |
| 音频调度         | `services/audioService.ts`，调度 Howl、LocalAudioPlayer、NativeAudioPlayer                    |
| Android 原生播放 | `services/nativeAudioPlayer.ts` → `window.AndroidNative` → Java NativeAudioEngine / ExoPlayer |
| 歌曲及歌词请求   | `hooks/usePlayerHooks.ts` 与 `api/`                                                           |
| 逐字显示         | `composables/useWordTimedPlayback.ts`，统一时间校准与显示数据                                 |
| 视觉公共状态     | `store/modules/styleEngine.ts`，共享高潮、主题色及音频特征                                    |
| 样式选择         | `playerStyles/index.ts` 注册；`components/lyric/MusicFullWrapper.vue` 选择移动组件            |
| 样式配置         | `config/playerStyleConfig.ts` 归一化，`config/playerStyleParams.ts` 声明可调参数              |
| 设置保存         | `components/player/MobilePlayerSettings.vue`                                                  |
| AI               | `features/ai/providers.ts`、`client.ts`，自带密钥与客户端直连                                 |
| 海报与视频       | `components/share/`、`utils/posterEngine.ts`、`utils/videoEngine.ts`                          |
| Android 容器     | `android/app/src/main/java/com/zephyrus/player/`                                              |
| 本地发布         | `scripts/workflow.mjs` → `scripts/workflow.py`                                                |

表中前端相对路径均以 `src/renderer/` 为根，应用启动行除外。

## 实现约束

### 歌词与异步请求

保留原始歌词与原始逐字时间，显示整理经 `normalizeLyricForDisplay` 投影，不写回原始缓存。普通 LRC 的补齐时长不能当成真实演唱句尾，也不能据此宣称有逐字数据。

TTML 自有库与 AMLL 走独立链路；平台请求顺序由 `lyricSource` store 管理。切歌、源变化、布局计算与软恢复都要校验当前歌曲及请求身份，避免旧请求覆盖新状态。时间单位在模块边界显式转换，原始供应商数据与秒级显示时间不可混用。

### 样式与设置

当前注册七种样式：`default`、`stage`、`starChart`、`wordCloud`、`dotMatrix`、`smoke`、`error`。`frenzy` 仅用于旧数据兼容，不能因类型中保留此键而将其列为可选样式。

配置按 `music-full-config.styleCustomConfig[styleKey]` 隔离。原始模式读取工厂值；新增参数应同时接入 schema、归一化、界面和实际消费。设置面板存在多个常驻实例，正常写入统一经过 `persistLyricConfig`，写前合并最新存储、写后回读，并广播 `music-full-config-updated`。避免增加绕过该流程的写入口。

播放设置分为歌曲／控制两页，控制页包含样式、布局、数据、音频、播放、工具、分享。新增子页须接入原生返回层，保持返回优先级与关闭动画一致。

### 动画与资源

先声明响应式绑定，再创建读取它的 watch；watch 的 source getter 在创建时就可能执行。相关初始化错误需要运行界面才能暴露，构建成功不能证明没有白屏。

词云布局使用固定种子，播放和控件显隐不重新排版；异步排版应支持取消。背景隐藏、被覆盖或页面进入后台时收敛绘制，并保留 `backgroundHealth` 降级。

视频皮肤必须是时间的确定性函数，不能使用 `Math.random()`。当前词云、点阵在界面和导出服务均拒绝视频导出，新增支持时应同时实现对应渲染器和能力判断。

### 持久化与恢复

播放恢复使用 `services/playbackSnapshot.ts`。切歌预写使用 `markSessionSnapshotSong` 标记身份，避免覆盖已经保存的进度。音频软恢复需要确认歌曲身份，尊重播放意图及恢复次数限制。

## 验证

```bash
npm run test:lyrics
npm run test:workflow
npm run typecheck:node
npm run typecheck:web
npm run lint:i18n
npm run build:web
```

无 Bun 且 Node.js 支持类型剥离时：

```bash
node --experimental-strip-types scripts/check_i18n.ts
```

`test:lyrics` 只运行 `tests/lyrics`，`test:workflow` 运行 `tests/workflow` 与 Python 发布测试，其他目录的测试需按改动选取：

```bash
npx vitest run --config vitest.config.ts tests/player/playbackStartup.test.ts
npx eslint src/renderer/path/to/changed-file.ts
```

Vitest 配置用于纯逻辑测试，没有 Vue SFC 插件。store、service 的导入链引入 `.vue` 会导致这类测试无法加载，应保持可测试边界。

`npm run lint` 带 `--fix`，会修改文件；只检查时使用不带 `--fix` 的 ESLint。Web 类型检查有已知存量错误，修改前后应比对错误列表。

涉及播放器、watch 初始化、横竖屏、手势或动画时，还需运行界面检查，并记录浏览器模拟或真机的验证环境。

## 发布与文档维护

按 [本地构建与服务器发布](./docs/local-workflow.md) 执行。更新检查读取自有服务器的 `latest.json`；Git tag 和 GitHub Release 不再触发当前本地构建流程。

- `README.md` 面向使用者介绍功能和用法，工程细节放在开发指南及技术资料中。
- `website/` 为用户指南，新增样式须同步总览、独立页面与侧栏。
- `docs/` 保存实现、运维及注明日期的调查记录，入口见 [维护文档索引](./docs/README.md)。
- `RELEASE_NOTES.md` 保存版本记录，不能把工作区实现直接表述为 APK 已发布。
- `COORDINATION.md` 是早期舞台开发的历史记录，其旧路径与分工不适用于当前工程。
