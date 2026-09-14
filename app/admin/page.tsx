"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

type PanelId = "login" | "panel-dashboard" | "panel-tmdb-config" | "panel-miruro-config" | "panel-frontend-config" | "panel-service-control" | "panel-live-config";

interface ServiceStatus {
  alive: boolean;
  latency: number;
  error?: string;
  name: string;
  url: string;
}

interface ConfigData {
  success: boolean;
  merged: Record<string, any>;
  override: Record<string, any>;
  overridePath?: string;
}

interface TmdbConfigForm {
  port: string;
  defaultRegion: string;
  defaultProviders: string;
  minQualitiesRaw: string;
  excludeCodecsRaw: string;
  febboxCookies: string[];
  tmdbApiKeys: string[];
  disableCache: boolean;
  enablePStreamApi: boolean;
  disableUrlValidation: boolean;
  disable4khdhubUrlValidation: boolean;
  enableProxy: boolean;
  showboxCacheDir: string;
  enableShowboxProvider: boolean;
  enable4khdhubProvider: boolean;
  enableVixsrcProvider: boolean;
}

type SiteBannerTheme = "info" | "warning" | "success" | "promo" | "danger";

interface BannerForm {
  enabled: boolean;
  message: string;
  linkHref: string;
  linkLabel: string;
  theme: SiteBannerTheme;
  dismissible: boolean;
  startsAt: string; // datetime-local input value, "" = no start restriction
  endsAt: string; // datetime-local input value, "" = no end restriction
}

const BANNER_THEME_OPTIONS: { key: SiteBannerTheme; label: string; swatch: string }[] = [
  { key: "info", label: "Info", swatch: "bg-blue-600" },
  { key: "success", label: "Success", swatch: "bg-green-600" },
  { key: "warning", label: "Warning", swatch: "bg-amber-500" },
  { key: "danger", label: "Danger", swatch: "bg-red-600" },
  { key: "promo", label: "Promo", swatch: "bg-orange-500" },
];

const BANNER_THEME_PREVIEW_STYLES: Record<SiteBannerTheme, { bg: string; fg: string }> = {
  info: { bg: "bg-blue-600", fg: "text-white" },
  success: { bg: "bg-green-600", fg: "text-white" },
  warning: { bg: "bg-amber-500", fg: "text-black" },
  danger: { bg: "bg-red-600", fg: "text-white" },
  promo: { bg: "bg-orange-500", fg: "text-black" },
};

// ══════════════════════════════════════════════════════════════
// API HELPERS
// ══════════════════════════════════════════════════════════════

class UnauthorizedError extends Error {
  constructor() {
    super("Session expired or not authenticated");
    this.name = "UnauthorizedError";
  }
}

async function apiPost(path: string, body?: any) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include", // always send the session cookie, even if pages are served cross-port
    cache: "no-store",
  });

  if (res.status === 401) {
    // Session cookie missing/expired - stop pretending the request "worked".
    // Callers should catch this and send the user back to the login screen.
    throw new UnauthorizedError();
  }

  if (!res.ok) {
    throw new Error(`Request to ${path} failed (${res.status})`);
  }

  return res.json();
}

// ══════════════════════════════════════════════════════════════
// LOGIN PAGE
// ══════════════════════════════════════════════════════════════

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [statusClass, setStatusClass] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setStatus("Authenticating...");
    setStatusClass("");
    try {
      const res = await apiPost("/api/admin/auth", { username: username.trim(), password });
      if (res.success) {
        setStatus("Success! Loading panel...");
        setStatusClass("text-green-400");
        setTimeout(onLogin, 400);
      } else {
        setStatus(res.error || "Login failed");
        setStatusClass("text-red-400");
      }
    } catch {
      setStatus("Network error");
      setStatusClass("text-red-400");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-xl p-8 shadow-2xl">
        <h1 className="text-2xl font-black tracking-tighter text-orange-500 text-center mb-2">STREAMANIME</h1>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 text-center mb-6">Admin Panel</p>

        <div id="lockoutBanner" className="hidden" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-black font-bold text-sm uppercase tracking-widest rounded-lg transition cursor-pointer"
          >
            Login
          </button>
          {status && (
            <p className={`text-xs text-center font-mono ${statusClass}`}>{status}</p>
          )}
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STATUS BLOCK COMPONENT
// ══════════════════════════════════════════════════════════════

function StatusCard({ service }: { service: ServiceStatus }) {
  const statusColor = service.alive ? "bg-green-500" : "bg-red-500";
  const statusText = service.alive ? "Online" : "Offline";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-300">{service.name}</h3>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${service.alive ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          {statusText}
        </span>
      </div>
      <p className="text-[10px] font-mono text-neutral-600 truncate">{service.url}</p>
      {service.alive && (
        <p className="text-[10px] font-mono text-neutral-500 mt-1">{service.latency}ms latency</p>
      )}
      {service.error && (
        <p className="text-[10px] font-mono text-red-400 mt-1 truncate">{service.error}</p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN ADMIN PANEL
// ══════════════════════════════════════════════════════════════

function AdminPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [activePanel, setActivePanel] = useState<PanelId>("panel-dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Once we hit a 401 we stop firing further requests/polling until the
  // user logs back in - otherwise a stale session spams the same failing
  // request every few seconds (which is what you were seeing in the console).
  const sessionExpiredRef = useRef(false);
  const [loadError, setLoadError] = useState("");

  const handleUnauthorized = useCallback(() => {
    if (sessionExpiredRef.current) return;
    sessionExpiredRef.current = true;
    onUnauthorized();
  }, [onUnauthorized]);

  // ── TMDB Config State ──────────────────────────────────────
  const [tmdbConfig, setTmdbConfig] = useState<ConfigData | null>(null);
  const [tmdbForm, setTmdbForm] = useState<TmdbConfigForm>({
    port: "8787",
    defaultRegion: "",
    defaultProviders: "",
    minQualitiesRaw: "all",
    excludeCodecsRaw: JSON.stringify({ excludeDV: false, excludeHDR: false }),
    febboxCookies: [],
    tmdbApiKeys: [],
    disableCache: false,
    enablePStreamApi: true,
    disableUrlValidation: false,
    disable4khdhubUrlValidation: false,
    enableProxy: false,
    showboxCacheDir: "",
    enableShowboxProvider: true,
    enable4khdhubProvider: true,
    enableVixsrcProvider: true,
  });
  const [tmdbSaveStatus, setTmdbSaveStatus] = useState("");
  const [febboxInput, setFebboxInput] = useState("");
  const [tmdbKeyInput, setTmdbKeyInput] = useState("");

  // ── Site Banner State ──────────────────────────────────────
  const [bannerForm, setBannerForm] = useState<BannerForm>({
    enabled: false,
    message: "",
    linkHref: "",
    linkLabel: "",
    theme: "info",
    dismissible: true,
    startsAt: "",
    endsAt: "",
  });
  const [bannerSaveStatus, setBannerSaveStatus] = useState("");
  const [bannerLoaded, setBannerLoaded] = useState(false);

  // ── Dashboard State ────────────────────────────────────────
  const [services, setServices] = useState<Record<string, ServiceStatus> | null>(null);
  const [loadingServices, setLoadingServices] = useState(true);

  // ── Service Control State ──────────────────────────────────
  const [controlStatus, setControlStatus] = useState("");
  const [controlLoading, setControlLoading] = useState(false);
  const [processState, setProcessState] = useState<Record<string, any> | null>(null);

  // ── Live Config State ──────────────────────────────────────
  const [liveConfig, setLiveConfig] = useState<Record<string, any> | null>(null);
  const [overrideConfig, setOverrideConfig] = useState<Record<string, any> | null>(null);

  // ── Load TMDB Config ───────────────────────────────────────
  const loadTmdbConfig = useCallback(async () => {
    if (sessionExpiredRef.current) return;
    try {
      const res = await apiPost("/api/admin/tmdb-config");
      if (res.success) {
        setTmdbConfig(res);
        setLiveConfig(res.merged || null);
        setOverrideConfig(res.override || null);
        const m = res.merged || {};
        setTmdbForm({
          port: String(m.port || "8787"),
          defaultRegion: m.defaultRegion || "",
          defaultProviders: (m.defaultProviders || []).join(", "),
          minQualitiesRaw: m.minQualitiesRaw || "all",
          excludeCodecsRaw: JSON.stringify(m.excludeCodecs || { excludeDV: false, excludeHDR: false }),
          febboxCookies: Array.isArray(m.febboxCookies) ? m.febboxCookies : [],
          tmdbApiKeys: Array.isArray(m.tmdbApiKeys) ? m.tmdbApiKeys : [],
          disableCache: !!m.disableCache,
          enablePStreamApi: m.enablePStreamApi !== false,
          disableUrlValidation: !!m.disableUrlValidation,
          disable4khdhubUrlValidation: !!m.disable4khdhubUrlValidation,
          enableProxy: !!m.enableProxy,
          showboxCacheDir: m.showboxCacheDir || "",
          enableShowboxProvider: m.enableShowboxProvider !== false,
          enable4khdhubProvider: m.enable4khdhubProvider !== false,
          enableVixsrcProvider: m.enableVixsrcProvider !== false,
        });
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) handleUnauthorized();
      else setLoadError("Couldn't load TMDB config.");
    }
  }, [handleUnauthorized]);

  // ── Load Dashboard Status ──────────────────────────────────
  const loadDashboard = useCallback(async () => {
    if (sessionExpiredRef.current) return;
    setLoadingServices(true);
    try {
      const res = await apiPost("/api/admin/service-status");
      if (res.success && res.services) {
        setServices(res.services);
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) handleUnauthorized();
      else setLoadError("Couldn't load service status.");
    } finally {
      setLoadingServices(false);
    }
  }, [handleUnauthorized]);

  // ── Load Site Banner Config ─────────────────────────────────
  const loadBannerConfig = useCallback(async () => {
    if (sessionExpiredRef.current) return;
    try {
      const res = await apiPost("/api/admin/frontend-config");
      if (res.success) {
        const b = res.banner || {};
        setBannerForm({
          enabled: !!b.enabled,
          message: b.message || "",
          linkHref: b.linkHref || "",
          linkLabel: b.linkLabel || "",
          theme: (b.theme as SiteBannerTheme) || "info",
          dismissible: b.dismissible !== false,
          startsAt: b.startsAt ? b.startsAt.slice(0, 16) : "",
          endsAt: b.endsAt ? b.endsAt.slice(0, 16) : "",
        });
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) handleUnauthorized();
      else setLoadError("Couldn't load the site banner config.");
    } finally {
      setBannerLoaded(true);
    }
  }, [handleUnauthorized]);

  // ── Load Process State ─────────────────────────────────────
  const loadProcessState = useCallback(async () => {
    if (sessionExpiredRef.current) return;
    try {
      const res = await apiPost("/api/admin/control");
      if (res.success) {
        setProcessState(res);
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) handleUnauthorized();
      else setLoadError("Couldn't load process state.");
    }
  }, [handleUnauthorized]);

  // ── Save TMDB Config ───────────────────────────────────────
  const handleSaveTmdbConfig = async () => {
    setTmdbSaveStatus("Saving...");
    try {
      const payload: Record<string, any> = {
        port: tmdbForm.port ? Number(tmdbForm.port) : null,
        defaultRegion: tmdbForm.defaultRegion || null,
        defaultProviders: tmdbForm.defaultProviders ? tmdbForm.defaultProviders.split(/[\s,]+/).filter(Boolean) : [],
        minQualitiesRaw: tmdbForm.minQualitiesRaw || "all",
        excludeCodecsRaw: tmdbForm.excludeCodecsRaw || null,
        febboxCookies: tmdbForm.febboxCookies,
        tmdbApiKeys: tmdbForm.tmdbApiKeys,
        tmdbApiKey: null,
        disableCache: tmdbForm.disableCache,
        enablePStreamApi: tmdbForm.enablePStreamApi,
        disableUrlValidation: tmdbForm.disableUrlValidation,
        disable4khdhubUrlValidation: tmdbForm.disable4khdhubUrlValidation,
        enableProxy: tmdbForm.enableProxy,
        showboxCacheDir: tmdbForm.showboxCacheDir || null,
        enableShowboxProvider: tmdbForm.enableShowboxProvider,
        enable4khdhubProvider: tmdbForm.enable4khdhubProvider,
        enableVixsrcProvider: tmdbForm.enableVixsrcProvider,
      };
      const res = await fetch("/api/admin/tmdb-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (data.success) {
        setTmdbSaveStatus("Saved ✔");
        loadTmdbConfig();
      } else {
        setTmdbSaveStatus(`Error: ${data.error || "Unknown"}`);
      }
    } catch (e: any) {
      setTmdbSaveStatus(`Error: ${e.message}`);
    }
  };

  // ── Service Control Handlers ───────────────────────────────
  const handleServiceAction = async (action: string, service: string) => {
    setControlLoading(true);
    setControlStatus(`${action} ${service}...`);
    try {
      const res = await fetch("/api/admin/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, service }),
        credentials: "include",
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (data.success) {
        setControlStatus(`${action} ${service}: Done`);
      } else {
        setControlStatus(`Error: ${data.error || "Unknown"}`);
      }
      await loadProcessState();
      await loadDashboard();
    } catch (e: any) {
      setControlStatus(`Error: ${e.message}`);
    } finally {
      setControlLoading(false);
    }
  };

  // ── Add / Remove FebBox Cookies ────────────────────────────
  const addFebboxCookie = () => {
    const val = febboxInput.trim();
    if (!val) return;
    if (tmdbForm.febboxCookies.includes(val)) { setFebboxInput(""); return; }
    setTmdbForm((prev) => ({ ...prev, febboxCookies: [...prev.febboxCookies, val] }));
    setFebboxInput("");
  };

  const removeFebboxCookie = (idx: number) => {
    setTmdbForm((prev) => ({ ...prev, febboxCookies: prev.febboxCookies.filter((_, i) => i !== idx) }));
  };

  // ── Add / Remove TMDB Keys ─────────────────────────────────
  const addTmdbKey = () => {
    const val = tmdbKeyInput.trim();
    if (!val) return;
    if (tmdbForm.tmdbApiKeys.includes(val)) { setTmdbKeyInput(""); return; }
    setTmdbForm((prev) => ({ ...prev, tmdbApiKeys: [...prev.tmdbApiKeys, val] }));
    setTmdbKeyInput("");
  };

  const removeTmdbKey = (idx: number) => {
    setTmdbForm((prev) => ({ ...prev, tmdbApiKeys: prev.tmdbApiKeys.filter((_, i) => i !== idx) }));
  };

  // ── Restart TMDB Server ────────────────────────────────────
  const handleRestartTmdb = async () => {
    if (!confirm("Restart TMDB Embed API? Active requests will be interrupted.")) return;
    setTmdbSaveStatus("Restarting...");
    try {
      const res = await fetch("/api/admin/tmdb-config/restart", {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      setTmdbSaveStatus(data.success ? "Restart triggered" : `Failed: ${data.error}`);
    } catch (e: any) {
      setTmdbSaveStatus(`Error: ${e.message}`);
    }
  };

  // ── Save Site Banner Config ────────────────────────────────
  const handleSaveBanner = async () => {
    setBannerSaveStatus("Saving...");
    try {
      const payload = {
        banner: {
          enabled: bannerForm.enabled,
          message: bannerForm.message.trim(),
          linkHref: bannerForm.linkHref.trim() || null,
          linkLabel: bannerForm.linkLabel.trim() || null,
          theme: bannerForm.theme,
          dismissible: bannerForm.dismissible,
          startsAt: bannerForm.startsAt || null,
          endsAt: bannerForm.endsAt || null,
        },
      };
      const res = await fetch("/api/admin/frontend-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (data.success) {
        setBannerSaveStatus("Saved ✔ — live on the site now");
      } else {
        setBannerSaveStatus(`Error: ${data.error || "Unknown"}`);
      }
    } catch (e: any) {
      setBannerSaveStatus(`Error: ${e.message}`);
    }
  };

  // ── Load data on panel mount ───────────────────────────────
  useEffect(() => {
    loadDashboard();
    loadTmdbConfig();
    loadProcessState();
    loadBannerConfig();
  }, [loadDashboard, loadTmdbConfig, loadProcessState, loadBannerConfig]);

  // ── Refresh dashboard periodically ─────────────────────────
  useEffect(() => {
    if (activePanel !== "panel-dashboard") return;
    const interval = setInterval(() => {
      if (sessionExpiredRef.current) {
        clearInterval(interval);
        return;
      }
      loadDashboard();
    }, 15000);
    return () => clearInterval(interval);
  }, [activePanel, loadDashboard]);

  // ════════════════════════════════════════════════════════════
  // NAVIGATION
  // ════════════════════════════════════════════════════════════

  const navItems: { id: PanelId; label: string; icon: string }[] = [
    { id: "panel-dashboard", label: "Dashboard", icon: "◉" },
    { id: "panel-tmdb-config", label: "TMDB Config", icon: "⚙" },
    { id: "panel-miruro-config", label: "Miruro Config", icon: "⚙" },
    { id: "panel-frontend-config", label: "Site Banner", icon: "▬" },
    { id: "panel-service-control", label: "Service Control", icon: "▶" },
    { id: "panel-live-config", label: "Live Config", icon: "{}" },
  ];

  const handleNav = (id: PanelId) => {
    setActivePanel(id);
    setSidebarOpen(false);
  };

  const handleLogout = async () => {
    await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
      credentials: "include",
    });
    window.location.reload();
  };

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex overflow-hidden">
      {/* Mobile burger */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-60 bg-orange-500 text-black border border-orange-600 rounded px-2.5 py-1.5 text-sm cursor-pointer hidden max-[880px]:block"
        aria-label="Toggle navigation"
      >
        ☰
      </button>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/45 backdrop-blur-sm z-40 hidden max-[880px]:block"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`w-[220px] bg-neutral-900/80 border-r border-neutral-800 flex flex-col p-4 gap-3 fixed top-0 left-0 bottom-0 overflow-y-auto z-50 transition-transform duration-200 max-[880px]:w-[220px] max-[880px]:fixed max-[880px]:inset-y-0 max-[880px]:left-0 ${
          sidebarOpen ? "max-[880px]:translate-x-0" : "max-[880px]:-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg font-black tracking-tighter text-orange-500">SA</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Admin</span>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                activePanel === item.id
                  ? "bg-orange-500 text-black"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
            >
              <span className="mr-2">{item.icon}</span>
              {item.label}
            </button>
          ))}

          <div className="flex-1" />

          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2.5 rounded text-xs font-bold uppercase tracking-wider text-red-400 border border-red-900/50 hover:bg-red-950/30 transition cursor-pointer mt-4"
          >
            Logout
          </button>
        </nav>

        <footer className="text-[9px] text-neutral-600 text-center mt-2">
          Made with ❤️
        </footer>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-[220px] min-h-screen overflow-y-auto max-[880px]:ml-0">
        <div className="p-6 md:p-8 max-w-5xl">
          {loadError && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-2 text-xs text-red-300">
              <span>{loadError}</span>
              <button
                onClick={() => setLoadError("")}
                className="text-red-400 hover:text-red-200 cursor-pointer text-sm leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
          {/* ────────────── DASHBOARD ────────────── */}
          {activePanel === "panel-dashboard" && (
            <section>
              <h1 className="text-lg font-bold uppercase tracking-widest text-neutral-200 mb-6">Dashboard</h1>

              <div className="mb-6">
                <h2 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Services</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {loadingServices ? (
                    <p className="text-xs text-neutral-500 col-span-3">Loading...</p>
                  ) : services ? (
                    Object.values(services).map((svc, i) => <StatusCard key={i} service={svc} />)
                  ) : (
                    <p className="text-xs text-red-400 col-span-3">Failed to load service status</p>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <h2 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Quick Actions</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleServiceAction("restart", "all")}
                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-black text-xs font-bold uppercase tracking-wider rounded-lg transition cursor-pointer"
                    disabled={controlLoading}
                  >
                    Restart All Services
                  </button>
                  <button
                    onClick={loadDashboard}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-bold uppercase tracking-wider rounded-lg border border-neutral-700 transition cursor-pointer"
                  >
                    Refresh Status
                  </button>
                </div>
              </div>

              <div>
                <h2 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">Process State</h2>
                <pre className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-[10px] font-mono text-neutral-400 overflow-auto max-h-48">
                  {processState ? JSON.stringify(processState, null, 2) : "No data"}
                </pre>
              </div>
            </section>
          )}

          {/* ────────────── TMDB CONFIG ────────────── */}
          {activePanel === "panel-tmdb-config" && (
            <section>
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-lg font-bold uppercase tracking-widest text-neutral-200">TMDB Embed Config</h1>
                <div className="flex gap-2">
                  <button
                    onClick={handleRestartTmdb}
                    className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-red-900/50 transition cursor-pointer"
                  >
                    Restart Server
                  </button>
                </div>
              </div>

              <div className="space-y-6 max-w-2xl">
                {/* Core Settings */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-4">Core Settings</h2>
                  
                  <div className="mb-4">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">API Port</label>
                    <input
                      type="text"
                      value={tmdbForm.port}
                      onChange={(e) => setTmdbForm((p) => ({ ...p, port: e.target.value }))}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                      placeholder="8787"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Default Region</label>
                    <select
                      value={tmdbForm.defaultRegion}
                      onChange={(e) => setTmdbForm((p) => ({ ...p, defaultRegion: e.target.value }))}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                    >
                      <option value="">(auto / none)</option>
                      <option value="USA7">US East</option>
                      <option value="USA6">US West</option>
                      <option value="USA5">US Middle</option>
                      <option value="UK3">United Kingdom</option>
                      <option value="CA1">Canada</option>
                      <option value="FR1">France</option>
                      <option value="DE2">Germany</option>
                      <option value="HK1">Hong Kong</option>
                      <option value="IN1">India</option>
                      <option value="AU1">Australia</option>
                      <option value="SZ">China</option>
                    </select>
                  </div>

                  <div className="mb-4">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-2">Provider Toggles</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: "enableShowboxProvider", label: "Showbox" },
                        { key: "enable4khdhubProvider", label: "4KHDHub" },
                        { key: "enableVixsrcProvider", label: "VixSrc" },
                      ].map((p) => (
                        <button
                          key={p.key}
                          onClick={() =>
                            setTmdbForm((prev) => ({
                              ...prev,
                              [p.key]: !(prev as any)[p.key],
                            }))
                          }
                          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition cursor-pointer ${
                            (tmdbForm as any)[p.key]
                              ? "bg-orange-500/20 border-orange-500 text-orange-400"
                              : "bg-neutral-800 border-neutral-700 text-neutral-500"
                          }`}
                        >
                          {p.label} {(tmdbForm as any)[p.key] ? "ON" : "OFF"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quality & Filtering */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-4">Quality &amp; Filtering</h2>

                  <div className="mb-4">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-2">Min Quality Preset</label>
                    <div className="flex flex-wrap gap-2">
                      {["all", "480p", "720p", "1080p", "1440p", "2160p", "custom"].map((q) => (
                        <button
                          key={q}
                          onClick={() => setTmdbForm((p) => ({ ...p, minQualitiesRaw: q }))}
                          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition cursor-pointer ${
                            tmdbForm.minQualitiesRaw === q
                              ? "bg-orange-500/20 border-orange-500 text-orange-400"
                              : q === "custom"
                              ? "bg-neutral-800 border-neutral-700 text-neutral-500"
                              : "bg-neutral-800 border-neutral-700 text-neutral-500"
                          }`}
                        >
                          {q === "custom" ? "Custom JSON" : q}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-2">Exclude Codecs</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: "none", label: "None" },
                        { key: "bothTrue", label: "All" },
                        { key: "dvOnly", label: "Dolby Vision" },
                        { key: "hdrOnly", label: "HDR" },
                      ].map((c) => {
                        const isActive =
                          (c.key === "none" && tmdbForm.excludeCodecsRaw === JSON.stringify({ excludeDV: false, excludeHDR: false })) ||
                          (c.key === "bothTrue" && tmdbForm.excludeCodecsRaw === JSON.stringify({ excludeDV: true, excludeHDR: true })) ||
                          (c.key === "dvOnly" && tmdbForm.excludeCodecsRaw === JSON.stringify({ excludeDV: true, excludeHDR: false })) ||
                          (c.key === "hdrOnly" && tmdbForm.excludeCodecsRaw === JSON.stringify({ excludeDV: false, excludeHDR: true }));
                        return (
                          <button
                            key={c.key}
                            onClick={() => {
                              const map: Record<string, string> = {
                                none: JSON.stringify({ excludeDV: false, excludeHDR: false }),
                                bothTrue: JSON.stringify({ excludeDV: true, excludeHDR: true }),
                                dvOnly: JSON.stringify({ excludeDV: true, excludeHDR: false }),
                                hdrOnly: JSON.stringify({ excludeDV: false, excludeHDR: true }),
                              };
                              setTmdbForm((p) => ({ ...p, excludeCodecsRaw: map[c.key] }));
                            }}
                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition cursor-pointer ${
                              isActive
                                ? "bg-orange-500/20 border-orange-500 text-orange-400"
                                : "bg-neutral-800 border-neutral-700 text-neutral-500"
                            }`}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* API Keys */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-4">TMDB API Keys</h2>
                  
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={tmdbKeyInput}
                      onChange={(e) => setTmdbKeyInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addTmdbKey(); }}
                      className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                      placeholder="Enter TMDB key"
                    />
                    <button
                      onClick={addTmdbKey}
                      className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-black text-[10px] font-bold uppercase tracking-wider rounded-lg transition cursor-pointer"
                    >
                      Add
                    </button>
                  </div>

                  <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                    {tmdbForm.tmdbApiKeys.length === 0 ? (
                      <p className="text-[10px] text-neutral-600 italic">No keys added</p>
                    ) : (
                      tmdbForm.tmdbApiKeys.map((key, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 bg-neutral-800 rounded px-2 py-1.5">
                          <code className="text-[10px] font-mono text-neutral-300 truncate">{key}</code>
                          <button
                            onClick={() => removeTmdbKey(i)}
                            className="text-red-400 hover:text-red-300 text-xs cursor-pointer shrink-0"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* FebBox Cookies */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-4">FebBox Cookies</h2>

                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={febboxInput}
                      onChange={(e) => setFebboxInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addFebboxCookie(); }}
                      className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                      placeholder="Enter ui token"
                    />
                    <button
                      onClick={addFebboxCookie}
                      className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-black text-[10px] font-bold uppercase tracking-wider rounded-lg transition cursor-pointer"
                    >
                      Add
                    </button>
                  </div>

                  <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                    {tmdbForm.febboxCookies.length === 0 ? (
                      <p className="text-[10px] text-neutral-600 italic">No cookies added</p>
                    ) : (
                      tmdbForm.febboxCookies.map((cookie, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 bg-neutral-800 rounded px-2 py-1.5">
                          <code className="text-[10px] font-mono text-neutral-300 truncate">{cookie}</code>
                          <button
                            onClick={() => removeFebboxCookie(i)}
                            className="text-red-400 hover:text-red-300 text-xs cursor-pointer shrink-0"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Advanced Flags */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-4">Advanced</h2>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { key: "disableCache", label: "Disable Cache" },
                      { key: "disableUrlValidation", label: "Disable URL Validation" },
                      { key: "disable4khdhubUrlValidation", label: "Disable 4KHDHub Validation" },
                      { key: "enableProxy", label: "Enable Stream Proxy" },
                      { key: "enablePStreamApi", label: "Enable PStream API" },
                    ].map((flag) => (
                      <button
                        key={flag.key}
                        onClick={() =>
                          setTmdbForm((prev) => ({
                            ...prev,
                            [flag.key]: !(prev as any)[flag.key],
                          }))
                        }
                        className={`px-3 py-3 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition cursor-pointer text-center ${
                          (tmdbForm as any)[flag.key]
                            ? "bg-orange-500/20 border-orange-500 text-orange-400"
                            : "bg-neutral-800 border-neutral-700 text-neutral-500"
                        }`}
                      >
                        {flag.label}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Showbox Cache Dir</label>
                    <input
                      type="text"
                      value={tmdbForm.showboxCacheDir}
                      onChange={(e) => setTmdbForm((p) => ({ ...p, showboxCacheDir: e.target.value }))}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                      placeholder="/data/showbox-cache"
                    />
                  </div>
                </div>

                {/* Save Button */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSaveTmdbConfig}
                    className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-black text-xs font-bold uppercase tracking-wider rounded-lg transition cursor-pointer"
                  >
                    Save Config
                  </button>
                  <span className={`text-[10px] font-mono ${tmdbSaveStatus.includes("✔") ? "text-green-400" : tmdbSaveStatus ? "text-neutral-400" : ""}`}>
                    {tmdbSaveStatus}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* ────────────── MIRURO CONFIG ────────────── */}
          {activePanel === "panel-miruro-config" && (
            <section>
              <h1 className="text-lg font-bold uppercase tracking-widest text-neutral-200 mb-6">MiruroAPI Config</h1>
              <p className="text-xs text-neutral-500 mb-4">
                MiruroAPI is configured via environment variables (.env) and restarting the service.
                Use the Service Control panel to restart it after changes.
              </p>

              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 max-w-2xl space-y-4">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">API Port</label>
                  <input
                    type="text"
                    defaultValue="3000"
                    readOnly
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Host</label>
                  <input
                    type="text"
                    defaultValue="0.0.0.0"
                    readOnly
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-500"
                  />
                </div>
                <div>
                  <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Available API Endpoints</h3>
                  <pre className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-[10px] font-mono text-neutral-500 overflow-auto max-h-48">
{`GET  /api/health
GET  /api/search?query=
GET  /api/trending
GET  /api/popular
GET  /api/upcoming
GET  /api/recent
GET  /api/spotlight
GET  /api/info/:id
GET  /api/episodes/:id
GET  /api/stream?provider=&anilistId=&slug=
GET  /api/download
GET  /api/genres
GET  /api/recommendations?profileId=`}
                  </pre>
                </div>
                <div>
                  <p className="text-[10px] text-neutral-500">
                    <strong>Note:</strong> MiruroAPI config is managed via the{" "}
                    <code className="text-orange-400">.env</code> file at the project root.
                    Edit it directly and restart the service using the Service Control panel.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ────────────── SITE BANNER ────────────── */}
          {activePanel === "panel-frontend-config" && (
            <section>
              <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
                <div>
                  <h1 className="text-lg font-bold uppercase tracking-widest text-neutral-200">Site Banner</h1>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    A site-wide announcement bar shown above the header on every page.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {bannerSaveStatus && <span className="text-[11px] font-mono text-neutral-400">{bannerSaveStatus}</span>}
                  <button
                    onClick={handleSaveBanner}
                    disabled={!bannerLoaded}
                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-black font-bold text-xs uppercase tracking-widest rounded-lg transition cursor-pointer disabled:opacity-50"
                  >
                    Save &amp; Publish
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6 max-w-5xl">
                {/* Left column: all the controls */}
                <div className="space-y-6">
                  {/* Visibility */}
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300">Visibility</h2>
                      <button
                        onClick={() => setBannerForm((p) => ({ ...p, enabled: !p.enabled }))}
                        className={`relative w-11 h-6 rounded-full transition cursor-pointer flex-shrink-0 ${
                          bannerForm.enabled ? "bg-orange-500" : "bg-neutral-700"
                        }`}
                        aria-pressed={bannerForm.enabled}
                        aria-label="Toggle banner enabled"
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                            bannerForm.enabled ? "translate-x-[22px]" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 mb-4">
                      {bannerForm.enabled ? "Banner will show on the site once saved." : "Banner is off — nothing will show, regardless of the fields below."}
                    </p>

                    <div className="flex items-center justify-between py-2 border-t border-neutral-800">
                      <div>
                        <p className="text-xs font-semibold text-neutral-300">Dismissible</p>
                        <p className="text-[10px] text-neutral-500">Lets visitors close it with an × (remembered per-browser).</p>
                      </div>
                      <button
                        onClick={() => setBannerForm((p) => ({ ...p, dismissible: !p.dismissible }))}
                        className={`relative w-11 h-6 rounded-full transition cursor-pointer flex-shrink-0 ${
                          bannerForm.dismissible ? "bg-orange-500" : "bg-neutral-700"
                        }`}
                        aria-pressed={bannerForm.dismissible}
                        aria-label="Toggle dismissible"
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                            bannerForm.dismissible ? "translate-x-[22px]" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-neutral-800 mt-3">
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Starts (optional)</label>
                        <input
                          type="datetime-local"
                          value={bannerForm.startsAt}
                          onChange={(e) => setBannerForm((p) => ({ ...p, startsAt: e.target.value }))}
                          className="w-full px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Ends (optional)</label>
                        <input
                          type="datetime-local"
                          value={bannerForm.endsAt}
                          onChange={(e) => setBannerForm((p) => ({ ...p, endsAt: e.target.value }))}
                          className="w-full px-2.5 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-[11px] font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-neutral-600 mt-2">Leave either blank for no restriction — e.g. set only "Ends" for a countdown-style notice.</p>
                  </div>

                  {/* Content */}
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-4">Content</h2>

                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Message</label>
                        <span className={`text-[10px] font-mono ${bannerForm.message.length > 140 ? "text-red-400" : "text-neutral-600"}`}>
                          {bannerForm.message.length}/140
                        </span>
                      </div>
                      <textarea
                        value={bannerForm.message}
                        onChange={(e) => setBannerForm((p) => ({ ...p, message: e.target.value.slice(0, 140) }))}
                        rows={3}
                        placeholder="e.g. Scheduled maintenance Friday 10PM–12AM EST — streaming may be briefly interrupted."
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-100 focus:outline-none focus:border-orange-500 resize-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Link URL (optional)</label>
                        <input
                          type="text"
                          value={bannerForm.linkHref}
                          onChange={(e) => setBannerForm((p) => ({ ...p, linkHref: e.target.value }))}
                          placeholder="/settings"
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-mono text-neutral-100 focus:outline-none focus:border-orange-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 block mb-1">Link Label</label>
                        <input
                          type="text"
                          value={bannerForm.linkLabel}
                          onChange={(e) => setBannerForm((p) => ({ ...p, linkLabel: e.target.value }))}
                          placeholder="Learn more"
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-100 focus:outline-none focus:border-orange-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Appearance */}
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-4">Appearance</h2>
                    <div className="flex flex-wrap gap-2">
                      {BANNER_THEME_OPTIONS.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setBannerForm((p) => ({ ...p, theme: t.key }))}
                          className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition cursor-pointer ${
                            bannerForm.theme === t.key
                              ? "border-orange-500 bg-orange-500/10 text-orange-400"
                              : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:border-neutral-600"
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full ${t.swatch}`} />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right column: live preview */}
                <div className="space-y-3">
                  <h2 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Live Preview</h2>
                  <div className="bg-neutral-950 border border-neutral-800 rounded-lg overflow-hidden">
                    {bannerForm.enabled && bannerForm.message.trim() ? (
                      <div className={`${BANNER_THEME_PREVIEW_STYLES[bannerForm.theme].bg} ${BANNER_THEME_PREVIEW_STYLES[bannerForm.theme].fg} px-4 py-2.5 text-center relative`}>
                        <p className="text-xs font-semibold leading-snug inline">
                          {bannerForm.message}
                          {bannerForm.linkHref && bannerForm.linkLabel && (
                            <span className="ml-2 underline underline-offset-2 font-bold">{bannerForm.linkLabel}</span>
                          )}
                        </p>
                        {bannerForm.dismissible && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm leading-none opacity-80">×</span>
                        )}
                      </div>
                    ) : (
                      <div className="px-4 py-6 text-center text-[11px] text-neutral-600">
                        {bannerForm.enabled ? "Add a message to preview the banner." : "Banner is disabled — nothing to preview."}
                      </div>
                    )}
                    {/* Mock header bar underneath, just to show it stacking above the real nav */}
                    <div className="h-14 bg-gradient-to-b from-black/95 to-black/60 flex items-center px-4 border-t border-neutral-900">
                      <span className="text-sm font-black tracking-tighter text-orange-500">STREAMANIME</span>
                    </div>
                    <div className="h-24 bg-neutral-900 flex items-center justify-center text-[10px] text-neutral-700 font-mono uppercase tracking-widest">
                      Page content
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-600">
                    On the real site the header slides down to make room — page content isn't covered.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ────────────── SERVICE CONTROL ────────────── */}
          {activePanel === "panel-service-control" && (
            <section>
              <h1 className="text-lg font-bold uppercase tracking-widest text-neutral-200 mb-6">Service Control</h1>
              <p className="text-xs text-neutral-500 mb-6">
                Start, stop, or restart the three backend services that power the platform.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                {/* MiruroAPI */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-300">MiruroAPI</h3>
                    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full ${
                      processState?.miruro?.running ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${processState?.miruro?.running ? "bg-green-500" : "bg-red-500"}`} />
                      {processState?.miruro?.running ? "Running" : "Stopped"}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-neutral-600 mb-3">Port 3000</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleServiceAction("start", "miruro")} disabled={controlLoading} className="px-3 py-1.5 bg-green-900/30 hover:bg-green-900/50 text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-green-900/50 transition cursor-pointer disabled:opacity-50">Start</button>
                    <button onClick={() => handleServiceAction("stop", "miruro")} disabled={controlLoading} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-red-900/50 transition cursor-pointer disabled:opacity-50">Stop</button>
                    <button onClick={() => handleServiceAction("restart", "miruro")} disabled={controlLoading} className="px-3 py-1.5 bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-yellow-900/50 transition cursor-pointer disabled:opacity-50">Restart</button>
                  </div>
                </div>

                {/* TMDB Embed */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-300">TMDB Embed</h3>
                    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full ${
                      processState?.tmdb?.running ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${processState?.tmdb?.running ? "bg-green-500" : "bg-red-500"}`} />
                      {processState?.tmdb?.running ? "Running" : "Stopped"}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-neutral-600 mb-3">Port 8787</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleServiceAction("start", "tmdb")} disabled={controlLoading} className="px-3 py-1.5 bg-green-900/30 hover:bg-green-900/50 text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-green-900/50 transition cursor-pointer disabled:opacity-50">Start</button>
                    <button onClick={() => handleServiceAction("stop", "tmdb")} disabled={controlLoading} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-red-900/50 transition cursor-pointer disabled:opacity-50">Stop</button>
                    <button onClick={() => handleServiceAction("restart", "tmdb")} disabled={controlLoading} className="px-3 py-1.5 bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-yellow-900/50 transition cursor-pointer disabled:opacity-50">Restart</button>
                  </div>
                </div>

                {/* Frontend */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-300">Frontend</h3>
                    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full ${
                      processState?.frontend?.running ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${processState?.frontend?.running ? "bg-green-500" : "bg-red-500"}`} />
                      {processState?.frontend?.running ? "Running" : "Stopped"}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-neutral-600 mb-3">Port 3001</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleServiceAction("start", "frontend")} disabled={controlLoading} className="px-3 py-1.5 bg-green-900/30 hover:bg-green-900/50 text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-green-900/50 transition cursor-pointer disabled:opacity-50">Start</button>
                    <button onClick={() => handleServiceAction("stop", "frontend")} disabled={controlLoading} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-red-900/50 transition cursor-pointer disabled:opacity-50">Stop</button>
                    <button onClick={() => handleServiceAction("restart", "frontend")} disabled={controlLoading} className="px-3 py-1.5 bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-yellow-900/50 transition cursor-pointer disabled:opacity-50">Restart</button>
                  </div>
                </div>
              </div>

              {/* Global Controls */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 mb-4 max-w-2xl">
                <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-300 mb-3">Global Controls</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleServiceAction("start", "all")}
                    disabled={controlLoading}
                    className="px-4 py-2 bg-green-900/30 hover:bg-green-900/50 text-green-400 text-xs font-bold uppercase tracking-wider rounded-lg border border-green-900/50 transition cursor-pointer disabled:opacity-50"
                  >
                    Start All
                  </button>
                  <button
                    onClick={() => handleServiceAction("stop", "all")}
                    disabled={controlLoading}
                    className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs font-bold uppercase tracking-wider rounded-lg border border-red-900/50 transition cursor-pointer disabled:opacity-50"
                  >
                    Stop All
                  </button>
                  <button
                    onClick={() => handleServiceAction("restart", "all")}
                    disabled={controlLoading}
                    className="px-4 py-2 bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 text-xs font-bold uppercase tracking-wider rounded-lg border border-yellow-900/50 transition cursor-pointer disabled:opacity-50"
                  >
                    Restart All
                  </button>
                  <button
                    onClick={() => handleServiceAction("start_script", "all")}
                    disabled={controlLoading}
                    className="px-4 py-2 bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 text-xs font-bold uppercase tracking-wider rounded-lg border border-blue-900/50 transition cursor-pointer disabled:opacity-50"
                  >
                    Run start-anime.sh
                  </button>
                </div>
                <p className="text-[10px] font-mono text-neutral-500 mt-3">
                  {controlStatus || "Ready"}
                </p>
              </div>

              <div>
                <button
                  onClick={() => { loadProcessState(); loadDashboard(); }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-bold uppercase tracking-wider rounded-lg border border-neutral-700 transition cursor-pointer"
                >
                  Refresh Process Status
                </button>
              </div>
            </section>
          )}

          {/* ────────────── LIVE CONFIG ────────────── */}
          {activePanel === "panel-live-config" && (
            <section>
              <h1 className="text-lg font-bold uppercase tracking-widest text-neutral-200 mb-6">Live Configuration</h1>

              <div className="space-y-6 max-w-2xl">
                <div>
                  <h2 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Merged Config</h2>
                  <p className="text-[10px] text-neutral-600 mb-2">Currently active configuration from all sources.</p>
                  <pre className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-[10px] font-mono text-neutral-400 overflow-auto max-h-96">
                    {liveConfig ? JSON.stringify(liveConfig, null, 2) : "Loading..."}
                  </pre>
                </div>

                <div>
                  <h2 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Overrides (user-config.json)</h2>
                  <p className="text-[10px] text-neutral-600 mb-2">User-defined settings that override default configuration.</p>
                  <pre className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-[10px] font-mono text-neutral-400 overflow-auto max-h-96">
                    {overrideConfig ? JSON.stringify(overrideConfig, null, 2) : "(none)"}
                  </pre>
                </div>

                <div>
                  <button
                    onClick={loadTmdbConfig}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-bold uppercase tracking-wider rounded-lg border border-neutral-700 transition cursor-pointer"
                  >
                    Refresh Config
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PAGE EXPORT (with login gate)
// ══════════════════════════════════════════════════════════════

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/auth", {
          credentials: "include",
          cache: "no-store",
        });
        const data = await res.json();
        setAuthed(data.authenticated === true);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  // Still checking auth
  if (authed === null) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  // Not authenticated: show login
  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  // Authenticated: show admin panel
  return <AdminPanel onUnauthorized={() => setAuthed(false)} />;
}