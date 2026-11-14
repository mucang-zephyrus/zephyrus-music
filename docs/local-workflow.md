# 本地构建与服务器发布

GitHub Actions 的 CI / APK workflow 已迁到 `scripts/workflow.py`，由 npm 入口自动寻找 Python。本地运行测试、构建和签名，服务器只保存 APK 与 `latest.json`。不需要 GitHub 账号、Token 或仓库 Secrets。

选择本地构建的原因：目前线上服务器只有约 4GB 内存、8GB 空闲磁盘，且运行音乐网关等服务；本地保留了发布密钥。将 Gradle、Android SDK 和签名留在本地，避免占用线上构建资源。

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

```bash
npm run workflow -- web
npm run workflow -- web --deploy
```

第二条在测试、构建成功后调用仓库的 `deploy_web.py`。设置 `ZEPHYRUS_SSH_PASSWORD`（或现有部署环境提供的值）；不要把密码写进受 Git 追踪的文件。Web 输出仍是 `src/renderer/dist`。

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

1. 在 `package.json` 与锁文件更新版本号，更新 `RELEASE_NOTES.md`。当前线上基线为 `1.4.1`，下一版可使用 `1.4.2`。
2. 选择高于线上 APK 的 `versionCode`（当前基线为 11），显式传入，避免以前 workflow 总是复用默认值。
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

没有新增版本号的这次工作流迁移不会覆盖现有 `1.4.1` APK。
