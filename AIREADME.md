# Zephyrus Music 发布约定

- 正式大版本发布到 `/zephyrus/web/`，正式 Android 更新信息由 `/zephyrus/apks/latest.json` 提供。
- 小更新发布到 `/zephyrus/webtest/`。Web 与测试 APK 使用相同的 `X.Y.Z-testN` 版本号。从 `test1` 开始。
- 界面打磨、文案调整和小修复沿用当前测试版本号。遇到重大 Bug 修复、明显的界面更新或功能更新，才递增测试后缀，例如 `1.4.3-test2`。
- 测试 APK 沿用正式版签名。每次发包的 Android `versionCode` 都要高于已发布的正式包和测试包。
- 测试站可直接访问和下载 APK。只有 Android 测试包检查 `/zephyrus/webtest/latest.json`，正式包使用正式更新渠道。部署后核对 Web 版本、下载链接和 APK 的 SHA-256。
- 测试版首次使用时说明版本可能不稳定，并提供 Bug 反馈入口。从 test1 升级且尚未选择鸣谢的用户会再收到提示。服务器保存公开与不公开的选择，其他设备使用同一已登录的音乐账号时会沿用。

正式站与测试站位于同一域名下。同一个浏览器配置会沿用已有的平台登录状态，任一站退出登录后，另一站重新打开时也会读取退出后的状态。

构建、签名和部署命令见 [本地工作流](docs/local-workflow.md)。
