// ============================================================
// 群控台 · 前端逻辑（标准网站架构 · 后端可切换）
//
// 流程：安装配置（选择后端类型 + 连接信息 + 可选备份恢复）→ 登录/验证 → 主界面
// 后端抽象：统一 backend 接口，按配置切换 Supabase 云后端 或 自建 Server。
// 备份：管理区导出 JSON；迁移时在安装页载入备份，进入后自动恢复。
//
// 将来迁移到标准服务器：只需改安装页的后端地址，前端零改动。
// ============================================================
"use strict";
const $ = id => document.getElementById(id);
const CFG_KEY = "autogo_config";      // 后端配置（localStorage）
const RESTORE_KEY = "autogo_restore"; // 待恢复的备份（localStorage）

let backend = null;   // 当前后端实例（统一接口）
let currentCfg = null;
let isSupabase = true;

// ---------- 配置加载 ----------
function loadConfig() {
  try {
    const s = localStorage.getItem(CFG_KEY);
    if (s) {
      const c = JSON.parse(s);
      if (c && c.mode && c.mode !== "supabase") {
        if (c.serverUrl) return c;
      } else if (c && c.url && c.key && !c.url.includes("YOUR-PROJECT") && !c.key.includes("YOUR-ANON-KEY")) {
        return { mode: "supabase", url: c.url, key: c.key };
      }
    }
  } catch (e) { /* 忽略损坏配置 */ }
  if (DEFAULT_CONFIG.mode === "server" && DEFAULT_CONFIG.serverUrl) {
    return { mode: "server", serverUrl: DEFAULT_CONFIG.serverUrl, serverToken: DEFAULT_CONFIG.serverToken };
  }
  if (DEFAULT_CONFIG.url && !DEFAULT_CONFIG.url.includes("YOUR-PROJECT") && !DEFAULT_CONFIG.key.includes("YOUR-ANON-KEY")) {
    return { mode: "supabase", url: DEFAULT_CONFIG.url, key: DEFAULT_CONFIG.key };
  }
  return null;
}

// ---------- 视图切换 ----------
function showInstall() {
  $("installView").style.display = "flex";
  $("loginView").style.display = "none";
  $("mainView").style.display = "none";
  const c = currentCfg || { mode: DEFAULT_CONFIG.mode, url: DEFAULT_CONFIG.url, key: DEFAULT_CONFIG.key, serverUrl: DEFAULT_CONFIG.serverUrl, serverToken: DEFAULT_CONFIG.serverToken };
  setMode(c.mode || "supabase");
  $("cfgUrl").value = c.url && !c.url.includes("YOUR-PROJECT") ? c.url : "";
  $("cfgKey").value = c.key && !c.key.includes("YOUR-ANON-KEY") ? c.key : "";
  $("cfgServerUrl").value = c.serverUrl || "";
  $("cfgServerToken").value = c.serverToken || "";
  $("cfgMsg").textContent = "";
}

function showLogin() {
  $("installView").style.display = "none";
  $("loginView").style.display = "flex";
  $("mainView").style.display = "none";
  $("loginMsg").textContent = "请输入账号密码登录";
}

function showMain() {
  $("installView").style.display = "none";
  $("loginView").style.display = "none";
  $("mainView").style.display = "block";
  $("whoami").textContent = backend.whoami();
  refreshAll();
  // 设备在线状态按需刷新（进入时一次 + 手动/选中设备时），不常驻轮询省请求；
  // 任务列表低频刷新以查看结果
  setInterval(refreshTasks, 20000);
}

// ---------- 后端模式切换（安装页） ----------
function setMode(mode) {
  isSupabase = mode !== "server";
  $("modeBtnSupabase").className = isSupabase ? "primary" : "";
  $("modeBtnServer").className = isSupabase ? "" : "primary";
  $("supabaseFields").style.display = isSupabase ? "" : "none";
  $("serverFields").style.display = isSupabase ? "none" : "";
}

// ---------- 安装配置页 ----------
async function testConnection() {
  $("cfgMsg").textContent = "测试中…";
  try {
    const err = await buildBackend(readCfgFromForm()).test();
    if (err) $("cfgMsg").textContent = "连接失败：" + err;
    else $("cfgMsg").textContent = "连接成功 ✅";
  } catch (e) { $("cfgMsg").textContent = "连接失败：" + e.message; }
}

function readCfgFromForm() {
  const cfg = { mode: isSupabase ? "supabase" : "server" };
  if (isSupabase) {
    cfg.url = $("cfgUrl").value.trim();
    cfg.key = $("cfgKey").value.trim();
  } else {
    cfg.serverUrl = $("cfgServerUrl").value.trim().replace(/\/+$/, "");
    cfg.serverToken = $("cfgServerToken").value.trim();
  }
  return cfg;
}

async function saveConfig() {
  const cfg = readCfgFromForm();
  if (isSupabase && (!cfg.url || !cfg.key)) { $("cfgMsg").textContent = "请填写 Project URL 与 anon key"; return; }
  if (!isSupabase && !cfg.serverUrl) { $("cfgMsg").textContent = "请填写服务器地址"; return; }
  currentCfg = cfg;
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  $("cfgMsg").textContent = "正在验证连接…";
  try {
    backend = buildBackend(cfg);
    const err = await backend.test();
    if (err) { $("cfgMsg").textContent = "连接失败：" + err; return; }
    if (isSupabase) {
      const { ok, msg } = await backend.login($("loginEmail").value.trim(), $("loginPass").value);
      if (!ok && msg !== "NEED_LOGIN") { $("cfgMsg").textContent = "登录失败：" + msg; showLogin(); return; }
      showLogin();
      $("loginMsg").textContent = "连接成功，请登录";
    } else {
      $("cfgMsg").textContent = "连接成功，进入主界面…";
      showMain();
      doRestoreIfPending();
    }
  } catch (e) { $("cfgMsg").textContent = "连接异常：" + e.message; }
}

function backToInstall() { showInstall(); }

// 选择备份文件（安装页）
function onPickBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj || obj.app !== "autogo-ctl" || !obj.data || !Array.isArray(obj.data.devices)) throw new Error("不是有效的 AutoGo 备份文件");
      localStorage.setItem(RESTORE_KEY, JSON.stringify(obj));
      $("cfgMsg").textContent = "备份已载入：设备 " + obj.data.devices.length + " 条、任务 " + (obj.data.tasks || []).length + " 条。保存配置并进入后自动恢复。";
    } catch (e) { $("cfgMsg").textContent = "备份解析失败：" + e.message; }
  };
  reader.readAsText(file);
}

// ---------- 后端抽象层 ----------
// 统一接口：test / login / logout / whoami / listDevices / listTasks /
//           createTask / clearDone / exportAll / restore
function buildBackend(cfg) {
  if (cfg.mode === "server") return new ServerBackend(cfg);
  return new SupabaseBackend(cfg);
}

// ---- Supabase 云后端 ----
class SupabaseBackend {
  constructor(cfg) { this.cfg = cfg; this.sb = null; }
  init() {
    if (!this.sb) this.sb = window.supabase.createClient(this.cfg.url, this.cfg.key);
  }
  async test() {
    try {
      const res = await fetch(this.cfg.url + "/rest/v1/", { headers: { apikey: this.cfg.key, Authorization: "Bearer " + this.cfg.key } });
      if (res.ok) return null;
      if (res.status === 401 || res.status === 403) return "key 无效或无权访问（请检查 anon key）";
      return "HTTP " + res.status;
    } catch (e) { return e.message; }
  }
  async login(email, pass) {
    this.init();
    if (!email || !pass) return { ok: false, msg: "NEED_LOGIN" };
    const { error } = await this.sb.auth.signInWithPassword({ email, password: pass });
    if (error) return { ok: false, msg: error.message };
    return { ok: true, msg: "" };
  }
  async logout() { this.init(); await this.sb.auth.signOut(); }
  whoami() {
    if (!this.sb) return "";
    return this.sb.auth.getUser()?.data?.user?.email || "";
  }
  async listDevices() {
    this.init();
    const { data, error } = await this.sb.from("devices").select("*").order("id");
    if (error) throw error;
    return data || [];
  }
  async listTasks(limit) {
    this.init();
    const { data, error } = await this.sb.from("tasks").select("*").order("id", { ascending: false }).limit(limit || 100);
    if (error) throw error;
    return data || [];
  }
  async createTask(action, params, target) {
    this.init();
    const { error } = await this.sb.from("tasks").insert({ action, target_device: target, params });
    if (error) return { ok: false, msg: error.message };
    return { ok: true, msg: "" };
  }
  async clearDone() {
    this.init();
    const { error } = await this.sb.from("tasks").delete().in("status", ["done", "failed"]);
    if (error) return { ok: false, msg: error.message };
    return { ok: true, msg: "" };
  }
  async exportAll() {
    this.init();
    const { data: devices, error: e1 } = await this.sb.from("devices").select("*").order("id");
    if (e1) throw e1;
    const { data: tasks, error: e2 } = await this.sb.from("tasks").select("*").order("id", { ascending: false }).limit(5000);
    if (e2) throw e2;
    return {
      app: "autogo-ctl", version: 1, exported_at: new Date().toISOString(),
      data: { devices: devices || [], tasks: tasks || [] }
    };
  }
  async restore(bak) {
    this.init();
    const msgs = [];
    const devs = bak.data.devices || [];
    if (devs.length) {
      const { error } = await this.sb.from("devices").upsert(devs, { onConflict: "id" });
      if (error) throw error;
      msgs.push("设备 " + devs.length + " 条");
    }
    const tasks = bak.data.tasks || [];
    if (tasks.length) {
      const rows = tasks.map(t => { const { id, ...rest } = t; return rest; });
      const { error } = await this.sb.from("tasks").insert(rows);
      if (error) throw error;
      msgs.push("任务 " + tasks.length + " 条");
    }
    return msgs.join("、");
  }
}

// ---- 自建 Server 后端 ----
class ServerBackend {
  constructor(cfg) { this.cfg = cfg; }
  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.cfg.serverToken) h["X-Token"] = this.cfg.serverToken;
    return h;
  }
  async j(method, path, body) {
    const res = await fetch(this.cfg.serverUrl + path, {
      method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok) {
      const msg = data && data.error ? data.error : "HTTP " + res.status;
      throw new Error(msg);
    }
    return data ? data.data : null;
  }
  async test() {
    try {
      const d = await this.j("GET", "/api/status");
      return d ? null : "服务器返回异常";
    } catch (e) { return e.message; }
  }
  async login() { return { ok: true, msg: "" }; }
  async logout() { /* token 模式无服务端会话 */ }
  whoami() { return "Server: " + this.cfg.serverUrl; }
  async listDevices() {
    return (await this.j("GET", "/api/devices")) || [];
  }
  async listTasks(limit) {
    return (await this.j("GET", "/api/tasks?limit=" + (limit || 100))) || [];
  }
  async createTask(action, params, target) {
    const d = await this.j("POST", "/api/task", { action, params, target_device: target });
    return { ok: true, msg: "" };
  }
  async clearDone() {
    await this.j("POST", "/api/tasks/clear");
    return { ok: true, msg: "" };
  }
  async exportAll() {
    const d = await this.j("GET", "/api/backup");
    return d;
  }
  async restore(bak) {
    const d = await this.j("POST", "/api/backup/import", { devices: bak.data.devices || [], tasks: bak.data.tasks || [] });
    return "设备 " + (d.devices || 0) + " 条、任务 " + (d.tasks || 0) + " 条";
  }
}

// ---------- 登录 ----------
async function doLogin() {
  const email = $("loginEmail").value.trim();
  const pass = $("loginPass").value;
  const { ok, msg } = await backend.login(email, pass);
  if (!ok) { $("loginMsg").textContent = "登录失败：" + msg; return; }
  showMain();
  doRestoreIfPending();
}

function logout() {
  if (backend) backend.logout();
  location.reload();
}

// ---------- 备份恢复（进入后检测） ----------
async function doRestoreIfPending() {
  const raw = localStorage.getItem(RESTORE_KEY);
  if (!raw) return;
  let bak;
  try { bak = JSON.parse(raw); } catch (e) { localStorage.removeItem(RESTORE_KEY); return; }
  const nDev = (bak.data.devices || []).length;
  const nTask = (bak.data.tasks || []).length;
  if (!confirm("检测到待恢复的备份：设备 " + nDev + " 条、任务 " + nTask + " 条。\n现在恢复到当前后端？（数据库需已执行迁移脚本 001/002）")) return;
  try {
    const summary = await backend.restore(bak);
    localStorage.removeItem(RESTORE_KEY);
    alert("数据恢复完成：" + summary);
    refreshAll();
  } catch (e) {
    alert("恢复失败：" + e.message + "\n请确认：① 后端已就绪；② 当前账号对表有读写权限。");
  }
}

// ---------- 清理已完成任务（管理区） ----------
async function clearDoneTasks() {
  if (!confirm("将删除所有已完成/失败的历史任务，保留排队和执行中的任务。确定？")) return;
  try {
    const { ok, msg } = await backend.clearDone();
    if (!ok) throw new Error(msg);
    alert("已清理历史任务");
    refreshTasks();
  } catch (e) { alert("清理失败：" + e.message); }
}

// ---------- 备份导出（管理区） ----------
async function exportBackup() {
  try {
    const bak = await backend.exportAll();
    const blob = new Blob([JSON.stringify(bak, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "autogo-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert("导出失败：" + e.message); }
}

// ---------- 工具 ----------
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function fmtTime(t) { if (!t) return "-"; const d = new Date(t); return d.toLocaleString("zh-CN", { hour12: false }); }
function ago(t) { if (!t) return "-"; const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000); if (s < 0) return "刚刚"; if (s < 60) return s + " 秒前"; if (s < 3600) return Math.floor(s / 60) + " 分钟前"; return fmtTime(t); }
function statusText(s) { return { pending: "排队中", taken: "执行中", done: "已完成", failed: "失败" }[s] || s; }
// 手机端心跳+poll 默认 300s，在线判定放宽到 15 分钟（3 个心跳周期容差）
function isOnline(d) { return d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < 900000; }

// ---------- 设备 ----------
let lastTasks = [];
async function refreshDevices() {
  try {
    const devs = await backend.listDevices();
    const runMap = {};
    if (isSupabase) {
      lastTasks.forEach(t => {
        if (!t.device_id) return;
        if (!runMap[t.device_id]) runMap[t.device_id] = { current: null, last: null };
        if (t.status === "taken" && !runMap[t.device_id].current) runMap[t.device_id].current = t;
        if ((t.status === "done" || t.status === "failed") && !runMap[t.device_id].last) runMap[t.device_id].last = t;
      });
    }
    let online = 0;
    $("deviceList").innerHTML = devs.length ? devs.map(d => {
      const dOnline = isSupabase ? isOnline(d) : !!d.online;
      if (dOnline) online++;
      const run = isSupabase ? (runMap[d.id] || {}) : { current: d.current_task || null, last: d.last_task || null };
      const runHtml = (run.current || run.last)
        ? `<div class="run">${run.current ? "▶ 执行中：" + esc(run.current.action) + " #" + run.current.id + "<br>" : ""}最近任务：${esc(run.last ? run.last.action : "-")} ${run.last ? '<span class="tag ' + run.last.status + '">' + statusText(run.last.status) + "</span>" : ""}</div>`
        : '<div class="run">尚无任务记录</div>';
      return `<div class="device-card">
        <div class="top"><span class="name">${esc(d.name || d.id)}</span><span class="tag ${dOnline ? "online" : "offline"}">${dOnline ? "在线" : "离线"}</span></div>
        <div class="meta">ID：${esc(d.id)}<br>型号：${esc(d.brand || "-")} ${esc(d.model || "-")} · 安卓 ${esc(d.android_version || "-")}<br>IP：${esc(d.ip || "-")} · 心跳 ${ago(d.last_seen)}</div>
        ${runHtml}
      </div>`;
    }).join("") : '<div class="empty">还没有设备接入，先在手机端启动客户端脚本</div>';
    $("devStat").textContent = "在线 " + online + " / " + devs.length;
    fillTargetSelect(devs, dOnline => dOnline);
  } catch (e) { $("deviceList").innerHTML = '<div class="empty">设备加载失败：' + esc(e.message) + "</div>"; }
}

function fillTargetSelect(devs, isOnlineFn) {
  const sel = $("targetDev");
  const cur = sel.value;
  const html = ['<option value="">（广播 · 所有在线设备）</option>']
    .concat(devs.map(d => {
      const on = isSupabase ? isOnline(d) : !!d.online;
      return '<option value="' + esc(d.id) + '">' + esc(d.name || d.id) + (on ? "（在线）" : "（离线）") + "</option>";
    })).join("");
  sel.innerHTML = html;
  if (cur) sel.value = cur;
  // 用户选择设备时，顺带刷新一次设备在线状态（按需）
  sel.onchange = refreshDevices;
}

// ---------- 任务 ----------
async function refreshTasks() {
  try {
    const tasks = await backend.listTasks(100);
    lastTasks = tasks || [];
    const body = $("taskBody");
    if (!lastTasks.length) { body.innerHTML = '<tr><td colspan="7"><div class="empty">暂无任务</div></td></tr>'; return; }
    body.innerHTML = lastTasks.map(t => {
      const ps = t.params ? Object.entries(t.params).map(([k, v]) => k + "=" + v).join(" ") : "";
      return `<tr>
        <td>${t.id}</td>
        <td><b>${esc(t.action)}</b><br><span style="font-size:12px;color:#64748b;">${esc(ps)}</span></td>
        <td>${t.target_device ? esc(t.target_device) : "广播"}</td>
        <td>${esc(t.device_id || "-")}</td>
        <td><span class="tag ${t.status}">${statusText(t.status)}</span></td>
        <td style="white-space:nowrap;">${fmtTime(t.created_at)}</td>
        <td><button class="btn-link" onclick="toggleResult(${t.id})">查看</button></td>
      </tr>
      <tr id="r${t.id}" class="task-result"><td colspan="7"></td></tr>`;
    }).join("");
    lastTasks.forEach(t => {
      const cell = document.getElementById("r" + t.id);
      if (!cell) return;
      let html = "";
      if (t.action === "screenshot" && t.status === "done" && t.result) html = '<img src="data:image/png;base64,' + t.result + '" alt="截图">';
      else if (t.status === "done" && t.result) html = esc(t.result);
      else if (t.status === "failed") html = esc("失败：" + (t.error || "未知错误"));
      else html = esc("状态：" + statusText(t.status));
      cell.querySelector("td").innerHTML = html;
    });
  } catch (e) { /* 网络或权限错误，下次重试 */ }
}

function toggleResult(id) { const el = document.getElementById("r" + id); if (el) el.classList.toggle("show"); }

// ---------- 下发任务 ----------
function target() { return $("targetDev").value || null; }

async function sendTask(action) {
  const params = {};
  const path = $("fPath").value.trim();
  if (["read_file","write_file","append_file","delete_file","list_dir","create_file","create_dir"].includes(action)) {
    if (!path) { alert("请填写文件路径"); return; }
    params.path = path;
  }
  if (action === "write_file" || action === "append_file") params.content = $("fContent").value;
  if (action === "shell") {
    const cmd = $("shCmd").value.trim();
    if (!cmd) { alert("请填写 shell 命令"); return; }
    params.cmd = cmd;
  }
  if (action === "app_launch") {
    const pkg = $("pkgName").value.trim();
    if (!pkg) { alert("请填写应用包名"); return; }
    params.package = pkg;
  }
  await submit({ action, params });
}

async function sendCustomTask() {
  const action = $("cAction").value.trim();
  if (!action) { alert("请填写操作类型 action"); return; }
  let params = {};
  const raw = $("cParams").value.trim();
  if (raw) { try { params = JSON.parse(raw); } catch (e) { alert("参数 JSON 格式错误：" + e.message); return; } }
  await submit({ action, params });
}

async function submit(payload) {
  const { ok, msg } = await backend.createTask(payload.action, payload.params, target());
  if (!ok) alert("下发失败：" + msg);
  else refreshTasks();
}

function refreshAll() { refreshDevices(); refreshTasks(); }

// ---------- 启动 ----------
(function boot() {
  currentCfg = loadConfig();
  if (!currentCfg) { showInstall(); return; }
  isSupabase = currentCfg.mode !== "server";
  backend = buildBackend(currentCfg);
  if (isSupabase) {
    backend.init();
    backend.sb.auth.getSession().then(({ data }) => data.session ? showMain() : showLogin());
  } else {
    backend.test().then(err => {
      if (err) { showInstall(); $("cfgMsg").textContent = "服务器连接失败：" + err; }
      else showMain();
    });
  }
})();
