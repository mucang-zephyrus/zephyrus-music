# Folia 波点／汽水接入调查

调查日期：2026-11-14（Asia/Shanghai）。本次完成源码核对及匿名只读接口探针，未接入产品、未改动线上服务。

## 版本与证据

Folia 的 main 快照：`8941961e0bd84341ab4d4921983f20c8dbba6db2`，提交时间 2026-11-13 20:35:04 +08:00；package.json 版本 `0.7.28`。此处是调查时取得的源码快照，不代表正式发布版本。

| 项目 | Folia 固定依赖 | npm 包 gitHead | 包许可 | 声明运行环境 |
| --- | --- | --- | --- | --- |
| 波点 | bodian-music-api@0.1.2 | 4c66678081541af27c93e527dc290c66e62035f7 | AGPL-3.0 | Node.js >=24 |
| 汽水 | qishui-music-api@0.2.2 | 924add376cadf8a2268f11999051eb976e3b8e0d | MIT | Node.js >=24 |

汽水 README 安装示例仍写 0.2.1；本次以 Folia package.json 和实际下载的 0.2.2 发布包为准。

Folia 源码证据：

- `src/services/onlineMusic/{bodian,qishui}/*Provider.ts`：能力声明及 UI 到平台操作的映射。
- 同目录 `*Transport.ts`：只接受 `window.electron.bodianRequest/qishuiRequest`，Web 无此桥接时直接返回不可用。
- `electron/{bodian,qishui}/*ApiBridge.cjs`：受限操作白名单、调用独立 npm 包、登记音频 URL。
- `electron/{bodian,qishui}/session.cjs`：设备身份与会话持久化，使用系统加密。
- `electron/{bodian,qishui}/mediaCors.cjs`：音频及已知图片域名的桌面跨域策略。
- 独立 npm 包 `src/{api,auth,catalog,library,playback}.cjs`：真实上游路径、鉴权及音频选取。

可复查的固定源地址：

```text
https://github.com/chthollyphile/folia-major/tree/8941961e0bd84341ab4d4921983f20c8dbba6db2
https://github.com/Mintcolour/bodian-music-api/tree/4c66678081541af27c93e527dc290c66e62035f7
https://github.com/GSQZ/qishui-music-api/tree/924add376cadf8a2268f11999051eb976e3b8e0d
```

下载快照及探针位于本仓库忽略目录 `node_modules/.cache/folia-platform-audit-20261114/`。探针结果仅保存歌曲 ID、长度、域名、状态及少量目录元数据，不保存会话、完整歌词或带签名音频 URL。

## 接入方式与可复用范围

Folia 调用链：renderer provider → preload/IPC → Electron 主进程 bridge → 独立 Node.js 包 → 上游 API/CDN。

两包均为调用库，不自带 HTTP 服务，不是可以填入前端配置的公共网关。协议不依赖 Folia renderer，适合由 Zephyrus 网关封装；不能将 Electron 的跨域放行机制直接迁移到浏览器。

建议 Web/PWA 和 Android 共用现有平台网关，桌面可按现有 IPC 架构接入同一平台适配层。该建议尚未实施。服务端应按 Zephyrus 登录用户、平台账号及设备身份隔离实例和 session，避免把 Folia 单机实例变成所有用户共享的上游账号。前端仅持有 Zephyrus 的会话引用，不接收汽水 guard 私钥或波点原始 token。

## 波点：桌面协议

主站：`https://bd-api.kuwo.cn`；歌词：`https://mlyric.kuwo.cn`。

使用稳定的 32 位小写十六进制设备 ID，桌面请求头及部分接口的查询／JSON body 签名由包生成。播放接口采用 **GET + JSON body**；不能直接改成浏览器 fetch GET，也不能只转发查询参数。

### 核心接口

以下是包已实现的上游路径；操作名是 Zephyrus 更适合复用的调用边界。

| 能力 | 包操作与输入 | 上游路径／方式 | 关键输出与限制 |
| --- | --- | --- | --- |
| 歌曲搜索 | `search({query,limit,offset})` | GET `/api/search/music/list`，keyword/correct/pn/rn | resultList、total、bodianPagination；当前包没有歌单／专辑／歌手搜索操作 |
| 歌曲详情 | `song_detail({id})` | GET `/api/service/music/info?musicId=...` | 歌曲、歌手、专辑、封面、duration、权限元数据 |
| 播放权限 | `audio` 内部先调用 | GET `/api/play/music/v2/checkRight`，带签名及 JSON body | status=3 返回 audition 试听；status=7 需要额外权限 |
| 音频链接 | `audio({id,quality,freeSign?})` | GET `/api/play/music/v2/audioUrl`，带签名及 JSON body | url、quality、fetchedAt；试听有 startTime/endTime |
| 歌词 | `lyrics({id})` | 歌词域 GET `/mobi.s`，f=bodian，q 为请求参数的 Base64 | mainText、wordByWordText；逐字时间已由包解码成 AWLRC |
| 歌单信息 | `playlist_detail({id,source?})` | GET `/api/service/playlist/info/{id}` | 保留 source，上游允许 1–6，默认 4 |
| 歌单歌曲 | `playlist_tracks({id,source?,limit,offset})` | GET `/api/service/playlist/{id}/musicList` | list、bodianPagination；该接口页码从 1 开始 |
| 专辑信息／歌曲 | `album_detail` / `album_tracks` | GET `/api/service/album/{id}`、`/api/service/album/music/{id}` | 专辑简介、歌曲；歌曲列表分页 |
| 歌手信息／歌曲／专辑 | `artist_detail` / `artist_songs` / `artist_albums` | GET `/api/service/artist/{id}`、`/api/service/artist/music/{id}`、`/api/service/artist/album/{id}` | 对应目录数据 |

音质：standard→128k MP3，high→320k MP3，lossless→FLAC；hires 在当前包中回退 lossless。须传递当前歌曲的 freeSign（存在时），不能只把歌曲 ID 接入通用解析。

### 账号与曲库

| 能力 | 操作 | 上游／行为 |
| --- | --- | --- |
| 获取二维码 key | `login_qr_key` | GET `/api/ucenter/login/qrCode` |
| 生成二维码图片 | `login_qr_create({key})` | 本地生成波点登录跳转二维码；不是额外的二维码图片 API |
| 查询扫码状态 | `login_qr_check({key})` | GET `/api/ucenter/login/qrCodeStatus`；确认后 POST `/api/ucenter/users/login`，authType=10 |
| 取消／登出 | `login_qr_cancel` / `logout` | 本地取消二维码、清理会话 |
| 账号信息 | `login_status` | **只返回本地恢复的 id/nickname/avatarUrl，不是实时远端账号验证**；当前公共用户类型没有 VIP 字段 |
| 个人歌单 | `user_playlists` | GET `/api/service/playlist/userCreate`、`/api/service/playlist/fond`、`/api/service/collect/4/list` |
| 收藏专辑 | `user_albums` | 从 `/api/service/collect/4/list` 混合列表中过滤 sourceType=6 |
| 喜欢列表 | `liked_songs` | 查询 fond 歌单，再按 source=5 读取 musicList |
| 喜欢／取消喜欢 | `like_song({id,liked})` | 定位当前账号 fond 歌单，POST `/api/service/playlist/music` 或 `/api/service/playlist/music/delete` |
| 自建歌单加／删歌 | `playlist_tracks_add/del({id,trackIds})` | 同上；trackIds 是逗号分隔字符串；先验证歌单属于当前账号，最多 100 首 |

二维码本地有效期 5 分钟，轮询间隔至少 2 秒。扫码凭据通过 session 仓库保存，不返回 renderer。不存在已实现的短信登录或可靠的远端 login_status 检查，不能伪装为支持。

### 推荐及尚缺能力

- `recommendations` → GET `/api/service/finds/playlist`。
- `home_module({moduleId:1})` → GET `/api/service/home/module`；`ai_playlist_detail({index})` → GET `/api/service/home/aiPlaylistDetail`，完整 musicList 用于 Discover。
- `personal_fm` → GET `/api/service/music/recommendList`。Folia 的能力说明同时指出波点不展示每日推荐入口，不能把 Discover、FM 和日推当成同一接口。
- 当前操作集没有评论、MV 获取、新建歌单、收藏／取消收藏歌单或专辑、最近播放的对应操作。
- 分页每次最多 100，必须采用 bodianPagination.nextOffset；收藏歌单与专辑共用上游混合分页，过滤后一页为空时仍可能存在下一页。
- 地区业务码 407 映射 region-restricted，不应清除登录态或不断自动跳歌。README 明确说明播放仅限中国大陆网络。

## 汽水：车机开放协议

目录主机：`https://open.douyin.com`；公共令牌及 access code 主机：`https://open.qishui.com`。

目录路径统一前缀：`/api/luna/v1/platform`。下表的 `/search/` 等路径均接在此前缀后。公共读取先取得 client token；账号读取、写入使用另外的 ticket-guard，二者不能混用。

### 核心接口

| 能力 | 包操作与输入 | 上游接口 | 关键输出与限制 |
| --- | --- | --- | --- |
| 公共令牌 | 内部 clientToken | GET open.qishui.com 的 `/client/token/get/` | 客户端令牌，供公共目录读取；不等于用户账号登录 |
| 歌曲搜索 | `search({query,limit,offset})` | POST `/search/`，search_type=track，q/cursor 等 | items、hasMore、nextOffset |
| 歌单搜索 | `search_playlists({query,limit,offset})` | POST `/search/`，search_type=playlist | 歌单实体；没有已实现的专辑搜索 |
| 歌曲详情 | `song_detail({id})` | POST `/media/mget/`，media_list=[{id,type:track}] | base_info、related_info、display_info、commerce_info；播放器模型留在服务端 |
| 音频链接 | `audio({id,quality})` | 先 `/media/mget/`，读取 player_info.full/preview.video_model_info | 从 video_model 或其 url_player_info/PlayInfoList 选未加密资源 |
| 歌词 | `lyrics({id})` | 同一个 `/media/mget/` 的 display_info.lyric_info | lyric_entity.type/content、lang_translations；不需要独立歌词域 |
| 歌单信息／歌曲 | `playlist_detail` / `playlist_tracks({id,ownerId?,limit,offset})` | POST `/playlist/detail/`，playlist_id/owner_id/count/cursor | collection、items、游标分页；ownerId 应跟随歌单保存 |
| 歌手信息 | `artist_detail({id})` | POST `/artist/detail/` | artist_info |
| 歌手热门歌曲 | `artist_songs({id,limit,offset})` | POST `/artist/tracks/` | 当前实现读取固定首批最多 50 首再本地分页，不能宣称完整歌手曲库 |
| 可播性批查 | `check_tracks({ids})` | POST `/media/mcheck/` | riskResult/status；0 表示可播，非 0 不自动等于下架 |

Folia 只开放 standard 音质。包主动跳过 encrypt/PlayAuth 等受保护资源，不提取音频密钥或解密。只有受保护资源时返回 unsupported；有试听则保留 preview/clipStartMs。**会员登录不能被承诺为完整高音质播放的解决方案。**

歌词已有解码后的 KRC/LRC 文本；Folia 先解析正文，再按行时间对齐 lang_translations，保留逐字数据，不从标题或显示文本猜测时间。

### 登录与账号接口

登录调用顺序：

1. `login_qr_key` → GET `https://open.douyin.com/oauth/get_qrcode/`，发起抖音扫码授权。
2. `login_qr_create({key})` → 取出二维码 data URL。
3. `login_qr_check({key})` → GET `https://open.douyin.com/oauth/check_qrcode/`。
4. 确认后 GET open.qishui.com 的 `/access/code/get/`，用 auth_code 换 access code。
5. 生成本次授权使用的 P-256 密钥和 CSR；POST `https://open-client.douyin.com/passport/open/get_access_ticket/`，取得 ticket/certificate。
6. 使用 ticket-guard POST `/me/info/`，读取 id、nickname、avatar、is_vip 并保存账号。

`login_status` 会读取 `/me/info/`，剩余有效期小于 1 小时时通过 open.qishui.com 的 `/access/code/refresh/` 和 ticket 交换续期。该账号检查与波点只读本地快照不同。

| 能力 | 操作 | 上游路径（目录前缀内） |
| --- | --- | --- |
| 自建与收藏歌单 | `user_playlists` | POST `/me/playlist/`、`/me/collection/mixed/` |
| 喜欢歌曲 | `liked_songs` | `/me/playlist/` 寻找 type=1 的喜欢歌单，再 `/playlist/detail/` 分页 |
| 喜欢／取消喜欢 | `like_song({id,liked})` | POST `/media/collect/`、`/media/cancel/collect/` |
| 歌单加／删歌 | `playlist_add_tracks/remove_tracks({id,ids})` | POST `/playlist/append/`、`/playlist/delete/`；单次最多 100 首 |
| 最近播放 | `recent_played({limit,offset})` | POST `/me/recent-played/` |
| 不感兴趣 | `dislike_song({id,disliked})` | POST `/dislike/` |
| 退出／取消扫码 | `logout` / `login_qr_cancel` | 本地清理 session／二维码状态 |

账号 ID 是不透明字符串，不应套用歌曲 ID 的纯数字约束；歌曲 ID 必须保留字符串，实测为 19 位数字，不能转 JavaScript Number。

### 推荐及尚缺能力

- `feed_modes` → POST `/feed/mode/`，返回场景电台分类。
- `feed({scene? / preference?,queue?,first?,limit?})` → POST `/feed/song-tab/`；scene 与 preference 互斥，队列状态按账号及模式隔离。
- 当前车机协议／操作集没有专辑详情、专辑曲目、收藏专辑、新建歌单、收藏／取消收藏歌单、评论、MV 的对应实现。歌曲可以带专辑文字元数据，但不应生成不能打开的专辑页链接。
- 歌单 cursor 不是 offset；包为顺序分页维护 5 分钟的账号／歌单／owner 游标记录，修改歌单、失败或切号会清理。
- 公共读取明确返回 28001008 时，仅刷新公共令牌并最多重试一次，不清除账号；账号验证收到明确鉴权业务码才清理当前 session。账号写入不会自动重放。

## 本次匿名实测

时间：2026-11-14 00:13:48–00:13:50 +08:00；本机网络；查询词“晴天”；两家各取 3 条结果。未创建二维码、未读取现有账户、未发起写入。

| 检查 | 波点 | 汽水 |
| --- | --- | --- |
| 搜索 | 成功，3 条；首条 ID 228908，周杰伦《晴天》 | 成功，3 条；首条 ID 7676337516358617115，标题《晴天》；未核验其是否同一录音 |
| 歌曲详情 | 成功，包含歌手／专辑／权限等字段 | 成功，包含 base/related/display/commerce 信息 |
| 歌词 | 成功；mainText 1463、wordByWordText 7127 个字符 | 成功；KRC 5425 个字符，本样本无翻译轨 |
| 音频接口 | standard，preview=true | standard，preview=false |
| 媒体范围请求 | HTTP 206，audio/mpeg | HTTP 206，audio/mp4 |
| 响应 Access-Control-Allow-Origin | 未返回 | `*` |

媒体仅发送 Range bytes=0-2047 并取消响应体，没有保存音频。该探针证明这些样本当时的匿名读取与媒体 URL 可访问，不代表已完成浏览器实际播放、整曲解码、登录、VIP 权益或所有歌曲验收。

探针运行于本机 Node v22.20.0，两包官方声明 Node >=24；本次成功不等于支持 Node 22。实际接入应按声明使用 Node 24+ 再做回归。波点探针直接调用包内 HTTP/catalog/playback 模块；汽水调用公共 createQishuiApi/request。

波点此资源缺少 CORS 头，HTML audio 的普通跨域播放与 Web Audio/fetch 分析是不同路径：Zephyrus 的鼓点、取色及缓存链不能依赖“audio 能播”就判定可用。需要媒体代理；若返回 HTTP 图片或音频，还需处理 HTTPS 页面混合内容。汽水本次 CDN 返回 `*`，仍需逐资源检测，不能假定所有 CDN 一致。

## Zephyrus 对应改造点与顺序

以下是调查建议，不是已实现功能。

1. 网关：在现有 server-platform-login.js 的平台框架中接入两个固定版本调用库，按用户隔离设备及加密会话，建立操作白名单。外层 HTTP 请求可统一 POST，由服务端保留上游实际方法，特别是波点 GET body。两包所需 Node 版本需与部署环境核对。
2. 数据模型：platformAccounts.ts 的 MUSIC_PLATFORMS 添加 bodian/qishui；扩展登录类型与平台文案。SongResult 使用 `bodian:ID` / `qishui:ID` 与 platform/platformId，新增平台专用上下文以保留波点 freeSign、歌单 source、汽水 ownerId。波点歌曲 duration 为秒，汽水 base_info.duration_ms 为毫秒，入口统一转换；LyricSource 增加对应来源，避免缓存混淆。
3. 先打通搜索→详情→音频→歌词的最小闭环。播放队列、下一首、播放界面列表与缓存使用同一解析入口，禁止只接搜索页点击。音频结果完整传递 preview、clipStartMs、quality、expiresAt，试听不得缓存为整曲。
4. 歌词接入现有 parseTimedLyrics/智能显示整理入口。汽水 KRC 可复用现有 krcParser，但仍需核对时基；波点 AWLRC 需要核对其行时间与词时间格式后适配，不能直接当 KRC 或 YRC。原文、翻译和逐字轨应保持来源及时间索引一致。
5. 登录→账号信息→个人歌单→喜欢列表→账号写入依次接入。波点只能提供当前包支持的账号公开字段；汽水 VIP 标志只用于显示，不推导高音质权限。未知或失败的喜欢列表不作为完整空列表覆盖同步数据。
6. 目录与推荐按能力显示：波点支持专辑与歌手专辑，汽水关闭不可用专辑入口、歌手全量曲库和未实现操作。评论与 MV 继续使用已有明确来源或隐藏，不把平台不支持当作接口故障。
7. Web 媒体代理处理 Range、206、Content-Range、Content-Type、CORS 及 URL 有效期；只代理服务端已签发或允许的媒体资源。Web/PWA、Android、桌面分别验收，不能用 Folia 的 Electron 跨域策略代替。

推荐实施顺序：匿名播放闭环 → 扫码与曲库 → 收藏写入 → 目录及推荐。验收时补充真实账号扫码、会话恢复／过期、来源切换、试听和账号切换中的在途请求；本次没有验证这些账号功能。
