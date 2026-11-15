<template>
  <footer class="site-footer hairline-t">
    <div class="site-shell footer-row">
      <div class="footer-brand">
        <img src="/zephyrus-mark.png" alt="" />
        <span>Zephyrus Player</span>
      </div>
      <span class="footer-copy">© 2026 mucang-zephyrus</span>
      <nav class="footer-links" aria-label="页脚导航">
        <a href="https://mucang.xyz/zephyrus/docs/">文档</a>
        <a href="/zephyrus/credits/">致谢与开源许可</a>
        <a href="https://github.com/mucang-zephyrus/zephyrus-music">GitHub</a>
        <a href="https://inspira-ui.com/docs/cn" rel="noopener">组件来自 Inspira UI</a>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  padding: 36px 0;
}

.footer-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 28px;
}

.footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-ink);
}

.footer-brand img {
  width: 18px;
  height: 18px;
}

.footer-copy {
  font-size: 12.5px;
  color: var(--color-ink-faint);
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-left: auto;
  font-size: 12.5px;
  color: var(--color-ink-dim);
}

.footer-links a {
  transition: color 180ms ease;
}

.footer-links a:hover {
  color: var(--color-ink);
}
</style>
