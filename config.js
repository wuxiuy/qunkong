// ============================================================
// 默认配置（模板）
// 首次打开群控台会出现"安装配置"页，可在网页上直接填写/修改，
// 并保存到浏览器本地——迁移数据库/后端后无需改代码，只需在安装页重新配置。
// 此文件仅作默认值，实际以安装页保存的配置为准。
// ============================================================
const DEFAULT_CONFIG = {
  // 后端类型：
  //   "supabase" —— Supabase 云后端（GitHub Pages + Supabase，默认）
  //   "server"   —— 自建 Server 后端（局域网 / 未来标准服务器）
  mode: "supabase",

  // Supabase 模式：Project URL + anon key
  url: "https://lbffnusqhfpntbpsdisn.supabase.co",   // Supabase Project URL
  key: "sb_publishable_HmUItjj-NhdrksviFnyX-A_o5tjRdt0", // Supabase publishable key（API Keys → publishable）

  // Server 模式：服务器地址 + token（token 为空表示不鉴权）
  serverUrl: "http://192.168.83.115:9000",             // 自建服务器地址
  serverToken: ""                                      // 服务器鉴权 token（与 -token 一致）
};
