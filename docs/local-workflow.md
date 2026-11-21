# 本地构建与服务器发布

使用 `scripts/workflow.py` 在本地运行测试、构建和签名，再将 APK 与 `latest.json` 上传到服务器。npm 入口会自动寻找可用的 Python。

## 环境

- Node.js 22+、Python 3.10+、JDK 21。
- Android SDK：`platforms;android-36`、`build-tools;36.0.0`、`platform-tools`。
- `JAVA_HOME` 指向 JDK 根目录，`ANDROID_HOME` 指向 SDK 根目录。
- Windows 也会检测 `%LOCALAPPDATA%/ZephyrusBuild/java/jdk-21*` 与 `%LOCALAPPDATA%/ZephyrusBuild/android-sdk`，无需改系统 PATH。
- Python 不在 PATH 时会检测 `%LOCALAPPDATA%/Programs/Python/*/python.exe`，也可以用 `PYTHON` 指定。
- 上传需要所选 Python 安装 `paramiko`；本地测试与构建只用 Python 标准库。

可用 Android Studio 的 SDK Manager 安装上述 SDK 包，或使用官网下载的命令行工具运行：

```text
sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

首次安装按提示阅读并接受 SDK 许可。然后检查：

```bash
npm run workflow -- doctor
npm run ci:local -- --install
```

`--install` 执行 `npm ci`，适合新环境或依赖变动后使用；默认复用本地依赖。`ci:local` 执行歌词测试、工作流回归测试与原 workflow 的完整构建，任一步失败即退出。项目现有 typecheck 存在基线错误，未把它包装成通过。

## Web

正式大版本发布到 `/zephyrus/web/`。小更新用 `X.Y.Z-testN` 编号，发布到 `/zephyrus/webtest/`。

```bash
npm run workflow -- web
npm run workflow -- web --deploy
```

第二条在测试、构建成功后调用仓库的 `deploy_web.py`。设置 `ZEPHYRUS_SSH_PASSWORD`（或现有部署环境提供的值）；不要把密码写进受 Git 追踪的文件。Web 输出仍是 `src/renderer/dist`。

## 测试版

```bash
npm run release:android -- --test-version 1.4.3-test2 --version-code 18
npm run workflow -- webtest dist/releases/1.4.3-test2-18
```

第一条用指定版本构建 Web 和正式签名 APK。第二条把这次生成的两份产物发到测试站。部署前保留对应的 `src/renderer/dist/`，下一次 Web 构建会覆盖它。每个测试版首次打开时会显示版本提示，包括 Bug 反馈入口。

界面打磨、文案调整和小修复沿用当前测试版本号。重大 Bug 修复、明显的界面更新或功能更新才递增后缀，例如 `1.4.3-test2`。Android `versionCode` 每次都要高于已发布的正式包和测试包，即使测试版本号相同。APK 文件名包含 `versionCode`，例如 `zephyrus-player-v1.4.3-test1-14.apk`。测试站可直接访问和下载 APK。正式包查询正式清单，Android 测试包查询 `/zephyrus/webtest/latest.json`。

鸣谢服务使用 `server/test-credits/app.py`。服务器将它放在 `/opt/zephyrus-test-credits/app.py`，用 `zephyrus-test` 系统用户运行 `server/test-credits/zephyrus-test-credits.service`，将 `server/test-credits/nginx-location.conf` 和 `server/webtest/nginx-location.conf` 加入站点 HTTPS 配置。数据库位于 `/var/lib/zephyrus-test-credits/credits.sqlite3`。`ZEPHYRUS_CREDITS_RELEASE` 指定鸣谢对应的正式版本，默认 `1.4.3`。

测试人员可以从已登录音乐账号选用昵称和头像，也可以自己填写。服务器使用账号标识的摘要识别已有选择，不读取平台登录凭据。鸣谢可在登记设备的「关于」修改或取消公开。

## Android 签名

保留原发布签名，备份现有 `.jks` 和密码。不要重新生成或替换密钥。`android/keystore.properties` 已忽略，格式为：

```properties
storeFile=zephyrus-release.jks
storePassword=填写原密码
keyAlias=填写原别名
keyPassword=填写原密码
```

`storeFile` 相对 `android/app`，也可以使用绝对路径。无本地配置时支持环境变量 `ZEPHYRUS_STORE_FILE`、`ZEPHYRUS_STORE_PASSWORD`、`ZEPHYRUS_KEY_ALIAS`、`ZEPHYRUS_KEY_PASSWORD`。发布前先检查签名配置，Gradle 的 release 构建也会拒绝缺失签名的产物。

## 构建与发布 APK

1. 在 `package.json` 与锁文件更新版本号，更新 `RELEASE_NOTES.md`。下方以 `1.4.2` 为例。
2. 选择高于服务器已发正式包和测试包的 `versionCode` 并显式传入。
3. 构建会运行测试、`npm run build`、Capacitor sync 和 Gradle，验证签名、包名、版本，产出 APK 与更新清单。
4. 发布前先运行 `--dry-run`：实际连接服务器、下载旧 APK、验证签名一致且版本递增；不替换任何发布文件。

```bash
npm run release:android -- --version-code 12
npm run release:publish -- dist/releases/1.4.2-12 --dry-run
npm run release:publish -- dist/releases/1.4.2-12
```

版本号取自 `package.json`。也可以 `--notes docs/my-release.md` 指定 UTF-8 发布说明。`dist/releases`、SDK、密码和密钥均不提交到 Git。没有安装 SDK 或缺少原签名时，工作流会明确退出，不会上传旧 APK 或未签名 APK。

服务器默认 `mucang.xyz`，账户 `root`，支持 `ZEPHYRUS_SSH_HOST` / `ZEPHYRUS_SSH_USER`。有 `ZEPHYRUS_SSH_PASSWORD` 时仅用密码，否则使用本机 SSH key/agent。建议提前核对并保存服务器 host key 到 `known_hosts`。

APK 使用不可变的版本文件名，SHA-256 校验上传内容后，再依次替换 `zephyrus-player-latest.apk` 软链接与 `latest.json`。应用读取自己的服务器更新信息，不再回退旧 GitHub 仓库。现有 `/zephyrus/apks/` nginx 路径可直接沿用，旧客户端仍能读取相同格式的清单。

## 服务器迁移与恢复

- 停用 crontab 中调用 `/opt/zephyrus-agent/apk-release-agent.sh` 的那一条任务，保留其他任务。操作前把完整 crontab 备份到仅 root 可读的文件中。
- `scripts/apk-release-agent.sh` 现在是退役提示脚本，避免旧调用再次覆盖本地发布；不再拉取 GitHub，也不自动删除历史 APK。
- 已发布 APK、下载软链接和清单不因迁移而删除；无需重新生成首个版本。
- 发布使用 `.publish-lock` 防止并发。进程被强制终止时，确认没有发布进程后移除该空目录，重新执行发布。
- 若上传阶段失败，线上入口保持原状；若最后的 HTTPS 验证失败，检查已上传文件和清单后再决定是否回滚。
- 回滚时将下载软链接与 `latest.json` 一起指回备份版本。Android 不允许普通覆盖安装降低 `versionCode`，已升级设备的修复应以更高版本重新发布。

## 产物与版本边界

- `npm run build:web` 输出 `src/renderer/dist/`，只供浏览器 Web 使用。
- `npm run build` 的渲染产物为 `src/renderer/dist/`，与 `capacitor.config.ts` 的 `webDir` 一致，APK 工作流在此之后执行 Capacitor sync。
- 正式包 `versionName` 取自 `package.json`，测试包从 `--test-version` 读取。`versionCode` 来自命令参数，由工作流注入 Gradle；不需要为了每次发版手动改写 Gradle 调试回退值。
- 当前工程最低 API 为 24（Android 7.0），编译及目标 API 为 36，见 `android/variables.gradle`。
- 文档更新、Git 提交或 Web 部署不自动生成或发布 Android APK。发布前以服务器实际包信息和预演结果为准。

## 用户文档站

`website/` 是独立的 VitePress 工程，不参与播放器的 Web 构建。首次安装及本地构建：

```bash
npm --prefix website ci
npm --prefix website run build
```

产物位于 `website/.vitepress/dist/`，部署基路径为 `/zephyrus/docs/`。文档站构建不会上传服务器，也不会修改 APK 更新清单。
