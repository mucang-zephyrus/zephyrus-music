# 网易云取链网关隔离验证

验证时间：2026-11-11 23:59 至 2026-11-12 00:03，Asia/Shanghai。

## 结论

同一服务器公网出口、同一轮匿名 Cookie 和 deviceId、相同歌曲及 exhigh 请求音质下，现网旧库与 Alger 4.32.0 在正式三首样本中各出现 2 次 -460，Enhanced 4.41.1 的 xeapi 在带／不带 randomCNIP 两组中均未出现 -460。结果支持继续验证 Enhanced xeapi 接入，但不足以宣称风控已经解决或完整播放已经通过。

这次未修改应用源代码、依赖和生产网关配置，未重启或部署生产服务。测试依赖只安装在服务器隔离临时目录，HTTP 测试监听回环地址，测试进程已退出。匿名 Cookie、公钥临时文件已经清理。

## 方法与范围

- 服务器 Node 20.20.2、npm 10.8.2；现网根包 NeteaseCloudMusicApi 4.32.0。
- 对照隔离安装的 netease-cloud-music-api-alger 4.32.0、@neteasecloudmusicapienhanced/api 4.41.1。安装禁用生命周期脚本，不修改 /opt/netease-api 的文件。
- 现网组使用现网磁盘上的 module/song_url_v1.js、util/request.js，在隔离探针进程中调用；不是向正在运行的公共 HTTP 网关发请求。这控制了出口、歌曲、凭据和请求顺序，但未覆盖现网进程内部状态、中间件、反向代理或真实浏览器会话。
- 各组共用一轮新取得的匿名凭据；不读取用户登录态，不使用 MUSIC_U，不自动换身份重试。
- 正式对照使用已通过 song_detail 确认身份的三首歌，按歌交错执行各组，组间等待 1.5 秒，每格一次请求，不自动重试。
- 取链直接调用真实发布包模块，拦截 Axios 仅记录公开端点、IP header 是否存在、耗时与状态，不记录 Cookie、签名音频 URL 或完整响应。
- 已关闭第三方通用解锁，结果来自网易云响应。

## 正式三首对照

“空地址”指外层 code=200、歌曲项 code=404、url=null；它不是播放成功。“试听”指返回 freeTrialInfo 对象。

| 链路 | 海阔天空 · Beyond，347230 | 其实都没有 · 杨宗纬，25788001 | 平凡之路 · 朴树，28815250 | -460 次数 |
| --- | --- | --- | --- | --- |
| 现网库 4.32.0，默认 eapi | 空地址 | -460 | -460 | 2/3 |
| Alger 4.32.0，默认 eapi | 空地址 | -460 | -460 | 2/3 |
| Enhanced 4.41.1，xeapi，不带来源 IP header | 空地址 | 空地址 | 试听地址 | 0/3 |
| Enhanced 4.41.1，xeapi，randomCNIP=true | 试听地址 | 空地址 | 试听地址 | 0/3 |
| Enhanced 4.41.1，强制 eapi，不带来源 IP header | 试听地址 | -460 | 试听地址 | 1/3 |

这里每格只有一次请求，次数不能作为长期成功率或风控概率。全部请求按服务器同一公网出口发出；randomCNIP 只改变来源 IP 请求头，不改变 TCP 出口。

正式对照前另做了 9 次探索取链：现网库 2/3 次 -460，Alger 3/3 次 -460，Enhanced xeapi 0/3 次 -460。其中包含一个未通过详情验证的旧 ID，故不将它混入正式三首样本统计。探索阶段同样拿到一次可读取的《海阔天空》试听地址。

## 实际协议与参数

抓取的实际出站路径：

- 现网库／Alger：interface.music.163.com/eapi/song/enhance/player/url/v1。
- Enhanced 默认 xeapi：interface3.music.163.com/xeapi/song/enhance/player/url/v1。
- Enhanced 强制 eapi：interfacepc.music.163.com/eapi/song/enhance/player/url/v1。
- 两库 song_detail 均为 music.163.com/weapi/v3/song/detail。

正式比较同时改变了协议、域名及客户端请求头，不能把全部差异单独归因于 xeapi 加密。Enhanced 强制 eapi 也比本次旧库样本少一次拒绝，进一步说明不能以“只换加密”解释全部结果。

xeapi 组无论是否设置 randomCNIP 都没有出现 -460，表明本次免于该拒绝并不要求该参数；带该参数的《海阔天空》获得地址，而不带时为空，说明它可能影响内容可用性。样本不足以将它确认为改善风控的原因。

各组取链请求默认 checkToken 均关闭，实际出站没有 X-antiCheatToken。本次结果不是实时生成抗风控 token 的验证结果。

## 可用性与歌曲详情

- xeapi 公钥初始化成功；匿名注册成功，取得 MUSIC_A。
- 三次独立的歌曲详情调用均返回 code=200：探索阶段旧库／Enhanced 各一次，正式阶段 Enhanced 一次。此次没有重现详情接口 -460，不代表此前浏览器遇到的问题不存在。
- 4 个拿到的 xeapi 音频地址执行有限 Range 字节读取，均返回 HTTP 206、audio/mpeg 和 ID3 文件头。请求只读取少量响应后取消，没有下载整首文件。
- 这些地址都属于匿名试听；会员全曲、无试听完整音源、真实浏览器音频播放未验证。
- 本次没有进行扫码确认、登录态续期、登录用户音质和长时间风控回归，不能视为全链升级验收。

## 模拟兼容性测试

18 项模块与导出断言通过：

- 歌曲 ID、level、固定 flac 编码参数、sky 参数路径。
- Alger 沿用默认 crypto，Enhanced 默认 xeapi。
- 返回对象结构保持，HTTP 200／400 包装的 -460 拒绝对象不丢失。
- Enhanced 导出歌曲方法及服务管理对象。

12 项真实回环 HTTP 断言通过，网易云出站请求为零：

- 现网 Express 4 外层可挂载创建好的 Enhanced Express 5 应用。
- Cookie 查询参数到取链模块的透传、默认 xeapi、randomCNIP=false。
- -460 保留 HTTP 400 及原始业务码；上游超时样例保留 HTTP 502。
- 网关没有自行重试每次拒绝。

发现明确接入约束：Enhanced 的 main.server 是含 serveNcmApi 的管理对象，不能直接 app.use(main.server)。升级必须显式创建中间件应用，或起独立回环服务再反代，不能仅替换包名。

Zephyrus 现有 tests/requestNetworkRisk.test.ts：5 项通过，包含 HTTP 400／200 包装 -460 的重试、成功重试和 noRetry。测试确认当前前端仍会在一次 -460 后自动再请求一次；删除提示并未删除重试。快速重试会增加拒绝后的请求次数，但本次未以持续在线压测证明其会增加风控概率。

## 建议后续实施

1. 将 Enhanced 4.41.1 作为独立服务接入验证，保留现有多平台网关；准备回切方式。
2. 管理 xeapi 公钥、匿名会话和启动超时，保留平台业务码及原始试听标识。
3. 对 -460 与瞬时网络故障采用不同策略，停止 500ms 无差别重试，给预取设置冷却；不恢复已经删除的风控弹窗。
4. 使用真实用户主动完成的登录态验证取链、会员权限及续期，再考虑生产切换。
5. 做低频、跨时间段的同歌对照。明确分别统计风控拒绝、无版权／无地址、试听、完整音源和音频可读，不能只统计外层 HTTP 200。

## 复核材料

隔离探针、脱敏结果保存在本机临时目录：

C:/Users/mucangzephyrus/AppData/Local/Temp/zephyrus-gateway-comparison-20261111/

- live-probe.cjs 与 results.json：探索对照。
- stage2-probe.cjs 与 stage2-results.json：三首正式矩阵。
- http-compat.cjs 与 http-results.json：回环 HTTP 兼容性。

结果文件不含凭据或签名音频链接。生产源代码、依赖和服务均未被替换。
