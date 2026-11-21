import { createRouter, createWebHashHistory } from 'vue-router';

import AppLayout from '@/layout/AppLayout.vue';
import homeRouter from '@/router/home';
import { isBareMobileLaunch, readMobileStartupTarget } from '@/router/mobileStartup';
import otherRouter from '@/router/other';

const loginRouter = {
  path: '/login',
  name: 'login',
  meta: {
    keepAlive: true,
    title: '登录',
    icon: 'icon-Home',
    back: true
  },
  redirect: { path: '/user/accounts', query: { panel: 'login' } }
};

const routes = [
  {
    path: '/',
    component: AppLayout,
    children: [...homeRouter, loginRouter, ...otherRouter]
  }
];

const router = createRouter({
  routes,
  history: createWebHashHistory()
});

let startupRouteResolved = false;

// 添加全局前置守卫
router.beforeEach((to, _, next) => {
  if (!startupRouteResolved) {
    startupRouteResolved = true;
    if (to.path === '/' && isBareMobileLaunch(window.location.hash)) {
      const startupTarget = readMobileStartupTarget();
      if (typeof startupTarget !== 'string' || startupTarget !== '/') {
        next(startupTarget);
        return;
      }
    }
  }

  if (['/mini', '/lyric', '/downloads'].includes(to.path)) {
    next('/');
    return;
  }

  // 其他情况正常导航
  next();
});

// 添加全局后置钩子，记录页面访问
router.afterEach((_to) => {
  // 使用setTimeout避免阻塞路由导航
  setTimeout(() => {}, 100);
});

export default router;
