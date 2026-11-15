---
layout: page
title: Zephyrus Music Android 文档
titleTemplate: false
---

<section class="docs-hero">
  <div class="docs-hero__visual" aria-hidden="true">
    <img src="/zephyrus-home.png" alt="" />
  </div>
  <div class="docs-hero__veil" aria-hidden="true"></div>
  <img class="docs-hero__mark" src="/zephyrus-mark.png" alt="" aria-hidden="true" />
  <div class="docs-hero__content">
    <p class="docs-kicker">ZEPHYRUS MUSIC · ANDROID</p>
    <h1>让歌词成为<br>播放界面本身</h1>
    <p class="docs-hero__lead">从安装、账号和音乐来源，到多来源逐字歌词、七种播放器样式、状态栏悬浮歌词与故障排查。</p>
    <div class="docs-actions">
      <a class="docs-action docs-action--primary" href="/zephyrus/docs/guide/installation">开始安装</a>
      <a class="docs-action" href="/zephyrus/docs/guide/getting-started">第一次使用</a>
    </div>
    <p class="docs-hero__meta">ANDROID · WEB · OPEN SOURCE</p>
  </div>
</section>

<section class="docs-launchpad">
  <div class="docs-section-heading">
    <p class="docs-kicker">01 · 选择入口</p>
    <h2>你现在要解决什么？</h2>
    <p>按任务进入，不必从头阅读整套文档。</p>
  </div>
  <div class="docs-route-list">
    <a href="/zephyrus/docs/guide/installation"><strong>安装与更新</strong><span>下载、系统要求、应用内更新与 ADB 安装</span><i>01</i></a>
    <a href="/zephyrus/docs/features/lyric-sources"><strong>歌词没有逐字</strong><span>检查 TTML、YRC、QRC、LRC 的来源与回退顺序</span><i>02</i></a>
    <a href="/zephyrus/docs/styles/overview"><strong>配置播放器</strong><span>七种样式、独立外观、字体与高潮效果</span><i>03</i></a>
    <a href="/zephyrus/docs/features/status-bar-lyrics"><strong>开启状态栏歌词</strong><span>悬浮窗权限、位置、逐字显示与分层颜色</span><i>04</i></a>
    <a href="/zephyrus/docs/guide/faq"><strong>排查异常</strong><span>播放、登录、歌词、字体与耗电问题</span><i>05</i></a>
  </div>
</section>

<section class="docs-timeline">
  <div>
    <p class="docs-kicker">02 · 歌词来源</p>
    <h2>逐字歌词，<br>也能显示和声与对唱。</h2>
  </div>
  <p>支持 TTML、YRC、QRC、KRC 和 LRC，可显示逐字进度、翻译与罗马音。TTML 还支持背景和声与对唱；在歌词来源设置中可以换源。</p>
  <ol class="docs-source-order">
    <li><b>01</b><span>Zephyrus TTML</span><small>主唱 · 背景 · 对唱</small></li>
    <li><b>02</b><span>AMLL TTML</span><small>主唱 · 背景 · 对唱</small></li>
    <li><b>03</b><span>网易云 YRC</span><small>逐字 · 翻译 · 罗马音</small></li>
    <li><b>04</b><span>QQ QRC</span><small>逐字 · 翻译 · 罗马音</small></li>
    <li><b>05</b><span>普通 LRC</span><small>按行同步歌词</small></li>
  </ol>
</section>

<section class="docs-stage-band">
  <div class="docs-stage-copy">
    <p class="docs-kicker">03 · 播放器舞台</p>
    <h2>每种视觉，保留自己的设置。</h2>
    <p>每种样式分别保存背景、歌词颜色、字体、字重和效果，随时可以一键还原。</p>
    <a href="/zephyrus/docs/features/custom-effects">查看外观与高潮效果 →</a>
  </div>
  <div class="docs-stage-names" aria-label="播放器样式">
    <span>默认</span><span>舞台</span><span>星盘</span><span>词云</span><span>点阵</span><span>烟雾</span><span>错误</span>
  </div>
</section>

<section class="docs-mobile">
  <figure>
    <img src="/zephyrus-home.png" alt="Zephyrus Music Android 首页" />
    <figcaption>Android 首页与底部播放栏</figcaption>
  </figure>
  <div class="docs-mobile__copy">
    <p class="docs-kicker">04 · 手机优先</p>
    <h2>左右滑动翻页，<br>上滑打开播放器。</h2>
    <p>在首页、歌单、发现和我的之间左右切换。底部播放栏可以拖动展开，也能打开队列和播放设置。</p>
    <div class="docs-inline-links">
      <a href="/zephyrus/docs/settings/interface">界面与手势</a>
      <a href="/zephyrus/docs/settings/playback">播放与歌词</a>
      <a href="https://mucang.xyz/zephyrus/">打开官方网站</a>
    </div>
  </div>
</section>

<section class="docs-support">
  <p class="docs-kicker">05 · 仍然有问题</p>
  <h2>先保存现场，再逐层排查。</h2>
  <p>记录歌曲名、来源平台、歌词格式、播放器样式、横竖屏状态和复现步骤。歌词问题先确认来源与时间校准，状态栏歌词先确认悬浮窗权限和系统电池限制。</p>
  <div class="docs-actions">
    <a class="docs-action docs-action--primary" href="/zephyrus/docs/guide/faq">打开故障排查</a>
    <a class="docs-action" href="https://github.com/mucang-zephyrus/zephyrus-music/issues">提交 GitHub Issue</a>
  </div>
</section>
