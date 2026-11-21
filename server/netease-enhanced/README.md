# 网易云 Enhanced 网关

网易云请求统一发往网关的 `/netease-enhanced` 路径，网关地址由 `VITE_MUSIC_GATEWAY` 配置。

Enhanced 固定为 `@neteasecloudmusicapienhanced/api@4.41.1`，以独立 systemd 服务监听 `127.0.0.1:3051`，通过 `/zephyrus/api/netease-enhanced/` 反代。歌曲取链沿用已验证的 `randomCNIP=true`；会员、版权及试听限制仍由网易云决定，不保证消除风控。

服务将设备身份、匿名会话和 xeapi 公钥保存于 `/var/lib/zephyrus-netease-enhanced`，不与原网关共用临时文件。不记录上游完整 URL、Cookie 或请求参数。仓库忽略本地 `.state`，不要提交运行状态。

部署顺序（仓库根目录，SSH 凭据通过环境变量提供）：

1. `py -u deploy_netease_gateway.py gateway` 安装固定依赖、启动独立服务、验证健康接口并增加 Nginx 路由；保留原网关。
2. `npm run build:web`，成功后 `py -u deploy_web.py` 发布 Web。
3. `py -u deploy_netease_gateway.py announcement` 将本地公告首条合入线上列表，保留旧公告并以 HTTP 验证。

网关部署备份保存在 `/opt/zephyrus-deploy-backups/<时间>/`，激活失败自动还原 Nginx、服务和版本软链接。恢复备份配置后先运行 `nginx -t`，再重新加载 Nginx。公告发布前备份线上文件到同目录的 `.backup-<时间>`。

2026-11-12 验证：请求方式与现有重试共 8 项单元测试通过；Edge 本地模拟接口验证切换、刷新持久化、实际 Axios 路由、移动端设置和第三张 Hero 跳转，运行异常为零。真实服务已验证歌曲详情、匿名试听取链和二维码生成；未验证用户扫码确认、会员完整音源或 iOS 真机。

上线记录：2026-11-12 已启用独立网关并发布 Web；网关健康接口、Web 首页和 manifest 均返回 HTTP 200。公告 `announce-20261112-netease-api` 已发布并经 HTTP 确认置顶，保留线上原有 2 条公告。Nginx 及服务部署备份：`/opt/zephyrus-deploy-backups/20261112-005424`。
