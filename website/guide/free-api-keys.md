# 密钥与服务商配置

AI 功能使用你配置的服务商、模型和 API 密钥。模型的可用范围、额度与费用请在服务商控制台确认。

## 配置步骤

1. 在服务商控制台创建密钥，确认账号可调用目标模型。
2. 打开应用设置中的“歌词 AI 解析”，选择服务商。
3. 填写密钥和模型 ID；自定义服务还需填写接口基础地址。
4. 保存后发起一次歌词分析。

模型下拉提供常用名称，也可手动填写。鉴权失败或模型不可用时，按错误提示核对配置。

## 智谱 AI {#zhipu}

在 [智谱开放平台](https://open.bigmodel.cn) 管理密钥和模型，应用服务商选择“智谱 AI”。

## DeepSeek {#deepseek}

在 [DeepSeek 开放平台](https://platform.deepseek.com) 管理密钥，应用选择“DeepSeek”。

## OpenRouter {#openrouter}

在 [OpenRouter](https://openrouter.ai) 管理密钥和模型。填写完整模型 ID，包括提供方前缀。

## OpenCode Zen {#opencodezen}

在 [OpenCode Zen](https://opencode.ai/zen) 查看接入说明，应用选择对应服务商，填写可用的模型。

## GitHub Models {#github-models}

在 [GitHub Models](https://github.com/marketplace/models) 查看账号可访问的模型及令牌权限，应用选择对应服务商。

## Pollinations {#pollinations}

应用提供 Pollinations 预设，当前预设无需填写密钥。连接失败时请核对服务当前的接入要求。

## 自定义服务 {#custom}

选择“自定义”，填写接口基础地址、模型及所需密钥。浏览器调用还需要接口允许跨域请求。

## 本地配置与请求

配置保存在当前设备，更换设备后需要重新填写。请求发送到所选服务商或自定义地址；反馈错误信息时请移除密钥与鉴权头。
