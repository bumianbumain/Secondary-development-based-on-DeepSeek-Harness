/**
 * 自包含登录页 HTML —— 由 node 半在 `/signin` 路由（核心 seam）直接下发。
 *
 * 视觉采用「HubPM」设计稿，并在其基础上做了一轮精细化：
 *   - 左面板 50%：渐变深蓝底（135deg, #24478C → #0D2152）+ 蓝紫/青绿光晕 +
 *     点阵纹理 + 漂浮装饰环；三段式（品牌 / 主文案 / 三栏价值特性）。
 *   - 右面板 50%：暖白 #FAFAF8 + 右上蓝雾 + 左下暖雾；顶部小字品牌标，
 *     居中 400px 表单列 + 页脚。
 *   - 动效：面板入场 fade-up 错峰；按钮 loading spinner；错误抖动。
 *   - 响应式：≥ 1024px 双栏；< 1024px 隐藏左栏。
 *
 * 与 SPA 闸门（client 半 LoginGate.tsx）同源；本页完全独立于 SPA 运行时
 * （无 React/模块表），由核心 webServer 在未认证访问 `/` 时 302 过来。
 * 登录成功后整页跳 `/`（由服务端 POST /login 签发 HttpOnly Cookie）。
 * client 半闸门保留作深度防御（SPA 内未认证遮罩），正常服务端流程不会触达。
 *
 * 安全边界：页面本身无任何敏感数据；鉴权完全由服务端 POST /login（HttpOnly
 * Cookie）与 /api/* 的 isAuthenticated 把守。
 *
 * @module @my-company/auth-login/signin-page
 */

/** 登录页交互脚本（ES5 兼容写法；用真实 /login 端点）。 */
const PAGE_SCRIPT = `(function () {
  'use strict'
  var emailShell = document.getElementById('emailShell')
  var pwdShell = document.getElementById('pwdShell')
  var emailInput = document.getElementById('email')
  var pwdInput = document.getElementById('pwd')
  var eyeBtn = document.getElementById('eyeBtn')
  var eyeIcon = document.getElementById('eyeIcon')
  var remember = document.getElementById('remember')
  var checkbox = document.getElementById('checkbox')
  var forgotBtn = document.getElementById('forgotBtn')
  var regBtn = document.getElementById('regBtn')
  var form = document.getElementById('loginForm')
  var submitBtn = document.getElementById('submitBtn')
  var errorEl = document.getElementById('error')
  var toast = document.getElementById('toast')

  if (emailInput) emailInput.focus()

  if (emailInput) {
    emailInput.addEventListener('focus', function () { if (emailShell) emailShell.classList.add('focused') })
    emailInput.addEventListener('blur', function () { if (emailShell) emailShell.classList.remove('focused') })
  }
  if (pwdInput) {
    pwdInput.addEventListener('focus', function () { if (pwdShell) pwdShell.classList.add('focused') })
    pwdInput.addEventListener('blur', function () { if (pwdShell) pwdShell.classList.remove('focused') })
  }

  var eyeOpen = '<path d="M1.9 9C3.1 6 5.8 4.2 9 4.2s5.9 1.8 7.1 4.8c-1.2 3-3.9 4.8-7.1 4.8S3.1 12 1.9 9Z" stroke="#9CA3AF" stroke-width="1.6" stroke-linejoin="round"/><circle cx="9" cy="9" r="2.3" stroke="#9CA3AF" stroke-width="1.6"/>'
  var eyeOff = '<path d="M2.4 9c1.2-3 3.9-4.8 7.1-4.8 1.6 0 3 .4 4.2 1.1M15.9 9c-1.2 3-3.9 4.8-7.1 4.8-1.5 0-2.9-.4-4-1" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="9" r="2.3" stroke="#9CA3AF" stroke-width="1.6"/><path d="M2 2 L16 16" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>'
  if (eyeBtn) eyeBtn.addEventListener('click', function () {
    if (pwdInput.type === 'password') {
      pwdInput.type = 'text'
      eyeIcon.innerHTML = eyeOff
      eyeBtn.setAttribute('aria-label', '隐藏密码')
    } else {
      pwdInput.type = 'password'
      eyeIcon.innerHTML = eyeOpen
      eyeBtn.setAttribute('aria-label', '显示密码')
    }
  })

  var checkedSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect width="16" height="16" rx="4" fill="#2E5BE0"/><path d="M4.2 8.4 L6.8 10.8 L11.8 5.2" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
  var uncheckedSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" stroke="#E3E3DB" stroke-width="1"/></svg>'
  if (checkbox) checkbox.addEventListener('click', function (e) {
    e.preventDefault()
    remember.checked = !remember.checked
    checkbox.innerHTML = remember.checked ? checkedSvg : uncheckedSvg
  })

  var toastTimer = null
  function showToast(text) {
    if (!toast) return
    toast.textContent = text
    toast.classList.add('show')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { toast.classList.remove('show') }, 1800)
  }
  if (forgotBtn) forgotBtn.addEventListener('click', function () { showToast('请联系管理员重置密码') })
  if (regBtn) regBtn.addEventListener('click', function () { showToast('尚未开放注册，请联系管理员') })
  var socialMap = { wechat: '微信登录尚未接入', sms: '短信登录尚未接入', feishu: '飞书登录尚未接入' }
  Array.prototype.forEach.call(document.querySelectorAll('[data-method]'), function (btn) {
    btn.addEventListener('click', function () { showToast(socialMap[btn.getAttribute('data-method')]) })
  })

  function setLoading(on) {
    if (!submitBtn) return
    if (on) submitBtn.classList.add('loading')
    else submitBtn.classList.remove('loading')
  }
  function showError(text) {
    if (!errorEl) return
    errorEl.textContent = text
    errorEl.style.display = 'block'
    errorEl.classList.remove('shake')
    // 触发重排以重启动画
    void errorEl.offsetWidth
    errorEl.classList.add('shake')
  }
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault()
    if (submitBtn.classList.contains('loading')) return
    var username = emailInput.value.trim()
    var password = pwdInput.value
    if (!username) { showError('请输入用户名'); if (emailInput) emailInput.focus(); return }
    if (!password) { showError('请输入密码'); if (pwdInput) pwdInput.focus(); return }
    errorEl.style.display = 'none'
    setLoading(true)
    fetch('/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    }).then(function (res) {
      if (res.ok) {
        submitBtn.querySelector('.btn-label').textContent = '登录成功，正在进入…'
        window.location.href = '/'
        return
      }
      setLoading(false)
      showError(res.status === 401 ? '账号或密码错误' : '登录失败（' + res.status + '）')
    }).catch(function () {
      setLoading(false)
      showError('网络异常，请稍后重试')
    })
  })
})();`

/** 自包含登录页（每次模块加载生成一次；无运行时外部依赖）。 */
export const SIGNIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="referrer" content="no-referrer" />
<title>HubPM · 登录</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: "Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
    background: #FAFAF8;
    color: #1D2129;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .root { position: relative; display: flex; flex-direction: row; align-items: stretch; min-height: 100vh; min-height: 100dvh; background: #FAFAF8; }
  @media (max-width: 1023px) { .root { flex-direction: column; } .left { display: none; } .right { flex: 1; } }

  /* ---------- 左面板 ---------- */
  .left {
    position: relative; flex: 0 0 50%; overflow: hidden;
    background:
      radial-gradient(120% 120% at 110% -10%, #2F5AA8 0%, rgba(47,90,168,0) 55%),
      linear-gradient(135deg, #24478C 0%, #0D2152 100%);
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 64px; color: #FFFFFF;
  }
  .glow-blue { position: absolute; top: -160px; right: -40px; width: 520px; height: 520px;
    background: radial-gradient(circle, rgba(79, 130, 255, 0.5) 0%, rgba(79, 130, 255, 0) 70%); pointer-events: none; }
  .glow-teal { position: absolute; bottom: -90px; left: -170px; width: 470px; height: 470px;
    background: radial-gradient(circle, rgba(46, 194, 186, 0.35) 0%, rgba(46, 194, 186, 0) 70%); pointer-events: none; }
  .ring { position: absolute; width: 360px; height: 360px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.10); top: 38%; left: -120px; pointer-events: none; }
  .ring::after { content: ''; position: absolute; inset: 48px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.08); }
  .dot-grid { position: absolute; inset: 0;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><circle cx='1.5' cy='1.5' r='1.3' fill='%23FFFFFF' fill-opacity='0.07'/></svg>");
    background-repeat: repeat; pointer-events: none; }

  .brand-row { position: relative; display: flex; align-items: center; gap: 12px; }
  .brand-row .logo { width: 36px; height: 36px; display: inline-block; }
  .brand-row .name { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }

  .copy-block { position: relative; display: flex; flex-direction: column; gap: 18px; max-width: 480px; }
  .copy-block h1 { margin: 0; font-size: 42px; line-height: 1.32; font-weight: 700; letter-spacing: 1px; }
  .copy-block .subtitle { margin: 0; font-size: 15px; line-height: 1.8; color: rgba(255,255,255,0.74); max-width: 410px; }

  .features { position: relative; display: flex; flex-direction: column; gap: 12px; }
  .feature { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 14px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
    backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
  .feature .ficon { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, rgba(108,155,255,0.9), rgba(46,91,224,0.9)); box-shadow: 0 6px 14px -4px rgba(46,91,224,0.5); }
  .feature .ftext { display: flex; flex-direction: column; gap: 2px; }
  .feature .ftitle { font-size: 14px; font-weight: 600; color: #FFFFFF; }
  .feature .fdesc { font-size: 12.5px; line-height: 1.55; color: rgba(255,255,255,0.66); }

  /* ---------- 右面板 ---------- */
  .right { position: relative; flex: 1 1 50%; background: #FAFAF8; overflow: hidden; display: flex; flex-direction: column; padding: 56px; }
  .tint-blue { position: absolute; top: -90px; right: -110px; width: 380px; height: 380px;
    background: radial-gradient(circle, rgba(217, 230, 255, 0.55) 0%, rgba(217, 230, 255, 0) 70%); pointer-events: none; }
  .tint-warm { position: absolute; bottom: -130px; left: -130px; width: 400px; height: 400px;
    background: radial-gradient(circle, rgba(255, 240, 214, 0.5) 0%, rgba(255, 240, 214, 0) 70%); pointer-events: none; }
  .right-brand { position: relative; display: flex; align-items: center; gap: 10px; }
  .right-brand .logo { width: 28px; height: 28px; display: inline-block; }
  .right-brand .name { font-size: 16px; font-weight: 700; color: #1D2129; letter-spacing: 0.5px; }

  .form-area { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; }
  form.form-col { display: flex; flex-direction: column; gap: 26px; width: 400px; max-width: 100%; }
  .head-block { display: flex; flex-direction: column; gap: 8px; }
  .head-block h2 { margin: 0; font-size: 27px; font-weight: 700; color: #1D2129; letter-spacing: 0.5px; }
  .head-block .subtitle { margin: 0; font-size: 14px; color: #5C6370; }

  .fields-wrap { display: flex; flex-direction: column; gap: 18px; }
  .field-block { display: flex; flex-direction: column; gap: 8px; }
  .field-block label.field-label { font-size: 13px; font-weight: 500; color: #3E4552; }
  .input-shell { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border-radius: 10px;
    background: #FFFFFF; border: 1px solid #E3E3DB; transition: border-color 140ms ease, box-shadow 140ms ease; }
  .input-shell.focused { border-color: #2E5BE0; box-shadow: 0 0 0 4px rgba(46, 92, 224, 0.14); }
  .input-shell .icon { width: 18px; height: 18px; flex: 0 0 18px; display: inline-flex; }
  .input-shell input { flex: 1; border: 0; outline: none; background: transparent; font-size: 14px; color: #1D2129; font-family: inherit; height: 100%; }
  .input-shell input::placeholder { color: #9CA3AF; }
  .input-shell .eye-btn { background: none; border: 0; padding: 0; cursor: pointer; display: inline-flex; width: 18px; height: 18px; }

  .opt-row { display: flex; align-items: center; justify-content: space-between; }
  .remember-group { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
  .remember-group .checkbox { width: 16px; height: 16px; display: inline-block; }
  .remember-group .label { font-size: 13px; color: #5C6370; }
  .link-btn { font-size: 13px; font-weight: 500; color: #2E5BE0; cursor: pointer; text-decoration: none; background: none; border: 0; padding: 0; font-family: inherit; }

  .submit-btn { position: relative; height: 48px; border-radius: 12px; background: #2E5BE0; color: #FFFFFF; border: 0;
    font-size: 15px; font-weight: 500; cursor: pointer; box-shadow: 0 12px 24px -8px rgba(46, 92, 224, 0.4);
    font-family: inherit; transition: background 140ms ease, transform 80ms ease; overflow: hidden; }
  .submit-btn:hover { background: #2850C8; }
  .submit-btn:active { transform: translateY(1px); }
  .submit-btn.loading { cursor: progress; }
  .submit-btn .btn-label { display: inline-block; }
  .submit-btn.loading .btn-label { visibility: hidden; }
  .submit-btn .btn-spinner { position: absolute; top: 50%; left: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
    border: 2px solid rgba(255,255,255,0.45); border-top-color: #FFFFFF; border-radius: 50%;
    opacity: 0; animation: spin 0.7s linear infinite; }
  .submit-btn.loading .btn-spinner { opacity: 1; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .divider-row { display: flex; align-items: center; gap: 12px; }
  .divider-line { flex: 1; height: 1px; background: #E7E5E0; }
  .divider-text { font-size: 12px; color: #9CA3AF; }
  .social-row { display: flex; align-items: center; justify-content: center; gap: 40px; }
  .social-item { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .social-btn { width: 44px; height: 44px; border-radius: 12px; background: #FFFFFF; border: 1px solid #E3E3DB;
    display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: border-color 140ms ease, transform 80ms ease; }
  .social-btn:hover { border-color: #C9CDD4; transform: translateY(-1px); }
  .social-btn svg { width: 22px; height: 22px; }
  .social-label { font-size: 12px; color: #5C6370; }

  .reg-row { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; color: #5C6370; }
  .reg-link { font-weight: 600; }

  footer.footer { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  footer.footer p { font-size: 12px; color: #9CA3AF; margin: 0; text-align: center; }
  footer.footer p.copy { color: #B4B9C1; }

  .error { font-size: 13px; color: #C0392B; margin: 0; }
  .error.shake { animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
  @keyframes shake {
    10%, 90% { transform: translateX(-1px); }
    20%, 80% { transform: translateX(2px); }
    30%, 50%, 70% { transform: translateX(-4px); }
    40%, 60% { transform: translateX(4px); }
  }

  .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;
    background: rgba(29, 33, 41, 0.92); color: #FFFFFF; font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    pointer-events: none; opacity: 0; transition: opacity 180ms ease; }
  .toast.show { opacity: 1; }

  /* ---------- 入场动画 ---------- */
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: no-preference) {
    .left .brand-row { animation: fadeUp 0.6s ease both; }
    .left .copy-block { animation: fadeUp 0.6s ease 0.08s both; }
    .left .features  { animation: fadeUp 0.6s ease 0.16s both; }
    .right-brand { animation: fadeUp 0.6s ease both; }
    form.form-col { animation: fadeUp 0.6s ease 0.12s both; }
    footer.footer { animation: fadeUp 0.6s ease 0.2s both; }
  }
</style>
</head>
<body>
<div class="root">
  <aside class="left">
    <div class="glow-blue"></div>
    <div class="glow-teal"></div>
    <div class="ring"></div>
    <div class="dot-grid"></div>

    <div class="brand-row">
      <span class="logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none">
          <defs>
            <linearGradient id="lgy" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
              <stop stop-color="#6C9BFF"/>
              <stop offset="1" stop-color="#2E5BE0"/>
            </linearGradient>
          </defs>
          <rect width="36" height="36" rx="10" fill="url(#lgy)"/>
          <path d="M18 10.5 L24.5 23 H11.5 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>
          <path d="M9.5 27 C12.5 25.6 15.5 25.6 18 27 C20.5 28.4 23.5 28.4 26.5 27" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" fill="none"/>
        </svg>
      </span>
      <span class="name">HubPM</span>
    </div>

    <div class="copy-block">
      <h1>项目管理中心枢纽</h1>
      <p class="subtitle">连接需求、任务、资源与 AI 辅助，让复杂项目协同变得有序、透明、可控。</p>
    </div>

    <div class="features">
      <div class="feature">
        <span class="ficon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2.5 17 6.25 10 10 3 6.25 10 2.5Z" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M3 10.25 10 13.75 17 10.25" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M3 14 10 17.5 17 14" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="ftext">
          <span class="ftitle">统一管控</span>
          <span class="fdesc">需求、任务、文档、人员集中管理，告别多系统切换。</span>
        </span>
      </div>
      <div class="feature">
        <span class="ficon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3 17V8M8 17V4M13 17V11M18 17V6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="ftext">
          <span class="ftitle">全局可见</span>
          <span class="fdesc">实时进度与风险看板，项目状态一目了然。</span>
        </span>
      </div>
      <div class="feature">
        <span class="ficon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2.5 11.7 7.3 16.5 9 11.7 10.7 10 15.5 8.3 10.7 3.5 9 8.3 7.3 10 2.5Z" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="ftext">
          <span class="ftitle">AI 辅助</span>
          <span class="fdesc">内置 Agent 自动推进重复工作，释放团队精力。</span>
        </span>
      </div>
    </div>
  </aside>

  <section class="right">
    <div class="tint-blue"></div>
    <div class="tint-warm"></div>

    <div class="right-brand">
      <span class="logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 36 36" fill="none">
          <defs>
            <linearGradient id="lgy2" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
              <stop stop-color="#6C9BFF"/>
              <stop offset="1" stop-color="#2E5BE0"/>
            </linearGradient>
          </defs>
          <rect width="36" height="36" rx="10" fill="url(#lgy2)"/>
          <path d="M18 10.5 L24.5 23 H11.5 Z" fill="#FFFFFF"/>
          <path d="M9.5 27 C12.5 25.6 15.5 25.6 18 27 C20.5 28.4 23.5 28.4 26.5 27" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" fill="none"/>
        </svg>
      </span>
      <span class="name">HubPM</span>
    </div>

    <div class="form-area">
      <form class="form-col" id="loginForm" novalidate>
        <div class="head-block">
          <h2>欢迎回来</h2>
          <p class="subtitle">登录 HubPM，继续推进你的工作</p>
        </div>

        <div class="fields-wrap">
          <div class="field-block">
            <label class="field-label" for="email">用户名</label>
            <div class="input-shell focused" id="emailShell">
              <span class="icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="1.6" y="3.2" width="14.8" height="11.6" rx="2.6" stroke="#2E5BE0" stroke-width="1.6"/>
                  <path d="M2.8 5.6 L9 10.2 L15.2 5.6" stroke="#2E5BE0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              <input id="email" type="text" autocomplete="username" placeholder="请输入用户名" />
            </div>
          </div>

          <div class="field-block">
            <label class="field-label" for="pwd">密码</label>
            <div class="input-shell" id="pwdShell">
              <span class="icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="3.4" y="7.8" width="11.2" height="8" rx="2.2" stroke="#9CA3AF" stroke-width="1.6"/>
                  <path d="M6 7.8V6.2a3 3 0 0 1 6 0v1.6" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
              </span>
              <input id="pwd" type="password" autocomplete="current-password" placeholder="请输入密码" />
              <button type="button" class="eye-btn" id="eyeBtn" aria-label="显示密码">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" id="eyeIcon">
                  <path d="M1.9 9C3.1 6 5.8 4.2 9 4.2s5.9 1.8 7.1 4.8c-1.2 3-3.9 4.8-7.1 4.8S3.1 12 1.9 9Z" stroke="#9CA3AF" stroke-width="1.6" stroke-linejoin="round"/>
                  <circle cx="9" cy="9" r="2.3" stroke="#9CA3AF" stroke-width="1.6"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="opt-row">
            <label class="remember-group">
              <span class="checkbox" id="checkbox">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" stroke="#E3E3DB" stroke-width="1"/>
                </svg>
              </span>
              <input type="checkbox" id="remember" style="display:none" />
              <span class="label">记住我</span>
            </label>
            <button type="button" class="link-btn" id="forgotBtn">忘记密码？</button>
          </div>
        </div>

        <p class="error" id="error" style="display:none"></p>

        <button type="submit" class="submit-btn" id="submitBtn">
          <span class="btn-label">登 录</span>
          <span class="btn-spinner" aria-hidden="true"></span>
        </button>

        <div class="divider-row">
          <span class="divider-line"></span>
          <span class="divider-text">其他登录方式</span>
          <span class="divider-line"></span>
        </div>

        <div class="social-row">
          <div class="social-item">
            <button type="button" class="social-btn" data-method="wechat">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path fill-rule="evenodd" d="M7.8 2.8C4.6 2.8 2 5 2 7.75c0 1.55.82 2.93 2.1 3.85l-.6 1.95 2.3-1.1c.62.17 1.28.27 1.96.27.2 0 .4-.01.6-.03-.1-.4-.16-.82-.16-1.24 0-2.83 2.66-5.13 5.94-5.13.2 0 .39.01.58.03C14.1 4.4 11.2 2.8 7.8 2.8Z" fill="#4B5260"/>
                <path fill-rule="evenodd" d="M14.72 7.52c-2.94 0-5.32 2-5.32 4.47 0 2.46 2.38 4.46 5.32 4.46.6 0 1.18-.08 1.72-.23l2.16 1.05-.56-1.9c1.24-.83 2-2.03 2-3.38 0-2.47-2.38-4.47-5.32-4.47Z" fill="#4B5260"/>
                <circle cx="5.9" cy="6.9" r="0.95" fill="#FFFFFF"/>
                <circle cx="9.9" cy="6.9" r="0.95" fill="#FFFFFF"/>
                <circle cx="12.9" cy="11.9" r="0.85" fill="#FFFFFF"/>
                <circle cx="16.5" cy="11.9" r="0.85" fill="#FFFFFF"/>
              </svg>
            </button>
            <span class="social-label">微信</span>
          </div>
          <div class="social-item">
            <button type="button" class="social-btn" data-method="sms">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 6.3A3.3 3.3 0 0 1 6.3 3h9.4A3.3 3.3 0 0 1 19 6.3v5.4a3.3 3.3 0 0 1-3.3 3.3H8.9l-4.4 3v-3.2A3.3 3.3 0 0 1 3 12.3V6.3Z" stroke="#4B5260" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M7 8.3h8M7 11.4h5.4" stroke="#4B5260" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </button>
            <span class="social-label">短信登录</span>
          </div>
          <div class="social-item">
            <button type="button" class="social-btn" data-method="feishu">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M19.6 2.4 2.6 9.3l6.2 2.4 2.4 6.2 8.4-15.5Z" stroke="#4B5260" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M8.8 11.7 19.6 2.4" stroke="#4B5260" stroke-width="1.7"/>
              </svg>
            </button>
            <span class="social-label">飞书</span>
          </div>
        </div>

        <div class="reg-row">
          <span>还没有账户？</span>
          <button type="button" class="link-btn reg-link" id="regBtn">立即注册</button>
        </div>
      </form>
    </div>

    <footer class="footer">
      <p>服务协议 · 隐私政策 · 帮助中心</p>
      <p class="copy">© 2026 云屿科技 · 京ICP备2026138420号-1</p>
    </footer>
  </section>
</div>

<div class="toast" id="toast"></div>

<script>
${PAGE_SCRIPT}
</script>
</body>
</html>
`
