# 安装与更新

Android 版通过 APK 安装，Web 版可直接在浏览器打开。两端分别更新，文档介绍开发版功能；安装包版本变更请查看更新说明。

## 下载与要求

- [下载 Android APK](https://mucang.xyz/zephyrus/apks/zephyrus-player-latest.apk)
- [打开 Web 版](https://www.mucang.xyz/zephyrus/web/)
- [产品介绍](https://mucang.xyz/zephyrus/)

当前开发版最低支持 Android 7.0。在线搜索、歌曲和歌词加载需要网络；本地音乐需要文件授权，状态栏歌词需要悬浮窗权限。

## 安装

1. 下载 APK，在下载管理器或文件管理器中打开。
2. 按提示允许安装应用。
3. 核对应用名为 Zephyrus Player，完成安装。
4. 按需要授予通知、文件或悬浮窗权限。

同签名的新版本可以覆盖安装并保留数据。若系统提示签名冲突或版本过低，请先核对安装包来源与版本。

## 首次使用

在“我的”中添加平台账号，播放歌曲后进入设置，选择样式和歌词选项。本地音乐可从歌单页的本地来源添加，状态栏歌词可在设置中搜索。

详见 [第一次使用](/guide/getting-started)。

## 更新

应用检查项目服务器上的更新，提供更新说明和 APK 下载入口。自动检查失败时，可以使用上方链接下载。

更新时请保留应用数据。卸载或清除数据会删除本机设置、字体、登录配置和部分缓存。

## ADB 安装

连接已授权设备，将下载的文件命名为 `zephyrus-player.apk` 后执行：

```bash
adb install -r zephyrus-player.apk
```

出现 `INSTALL_FAILED_VERSION_DOWNGRADE` 表示设备上安装了更高版本。签名冲突则需核对是否装有其他签名的测试包。排查前先保留本机数据。
