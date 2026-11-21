import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { gatewayBaseURL } from '@/api/gatewayBase';
import { useUserStore } from '@/store/modules/user';

import { isMobile } from '.';

// 扩展请求配置接口
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  retryCount?: number;
  noRetry?: boolean;
}

/**
 * 检测 Capacitor 环境（Android/iOS 原生壳）
 * Capacitor 会在 window 上注入 Capacitor 对象
 */
function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor;
}

// Capacitor 原生 HTTP 不支持 withCredentials，需要禁用
const isCapacitorEnv = isCapacitor();

const request = axios.create({
  baseURL: `${gatewayBaseURL}/netease-enhanced`,
  timeout: 15000,
  withCredentials: !isCapacitorEnv
});

// 最大重试次数
const MAX_RETRIES = 1;
// 重试延迟（毫秒）
const RETRY_DELAY = 500;

// 请求拦截器
request.interceptors.request.use(
  (config: CustomAxiosRequestConfig) => {
    // 只在retryCount未定义时初始化为0
    if (config.retryCount === undefined) {
      config.retryCount = 0;
    }

    // 在请求发送之前做一些处理
    // 在get请求params中添加timestamp
    config.params = {
      ...config.params,
      timestamp: Date.now(),
      device: isMobile.value ? 'mobile' : isCapacitor() ? 'capacitor' : 'web'
    };
    if (config.url?.split('?')[0] === '/song/url/v1') {
      config.params.randomCNIP = true;
    }
    const token = localStorage.getItem('token');
    const skipCookie = config.params.noCookie === true;
    if (token && !skipCookie && config.method !== 'post') {
      config.params.cookie = config.params.cookie !== undefined ? config.params.cookie : token;
    } else if (token && !skipCookie && config.method === 'post') {
      config.data = {
        ...config.data,
        cookie: token
      };
    }

    return config;
  },
  (error) => {
    // 当请求异常时做一些处理
    return Promise.reject(error);
  }
);

const NO_RETRY_URLS = ['暂时没有'];

// 响应拦截器
request.interceptors.response.use((response) => {
  // Some gateways return API failures inside an HTTP 200 envelope.
  if (response.data?.code === -460) {
    return handleRequestError(
      new AxiosError(
        'Network environment risk',
        'ERR_BAD_RESPONSE',
        response.config,
        response.request,
        response
      )
    );
  }
  return response;
}, handleRequestError);

async function handleRequestError(error: AxiosError) {
  console.error('error', error);
  const config = error.config as CustomAxiosRequestConfig;

  // 如果没有配置，直接返回错误
  if (!config) {
    return Promise.reject(error);
  }

  // 处理 301 状态码
  if (error.response?.status === 301 && config.params.noLogin !== true) {
    // 使用 store mutation 清除用户信息
    const userStore = useUserStore();
    userStore.handleLogout();
    config.retryCount = 3;
  }

  // 检查是否还可以重试
  const canRetry =
    config.retryCount !== undefined &&
    config.retryCount < MAX_RETRIES &&
    !NO_RETRY_URLS.includes(config.url as string) &&
    !config.noRetry;

  if (canRetry) {
    config.retryCount = (config.retryCount ?? 0) + 1;
    console.error(`请求重试第 ${config.retryCount} 次`);

    // 延迟重试
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));

    // 重新发起请求
    return request(config);
  }

  console.error(`重试${MAX_RETRIES}次后仍然失败`);
  return Promise.reject(error);
}

export default request;
