import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { createRoot } from "react-dom/client";
import { ApiError, api } from "./api.js";
import { ProductPage } from "./pages.jsx";
import "./styles.css";

const AuthContext = createContext(null);

const managerRoutes = [
  { path: "/", label: "Dashboard" },
  { path: "/leads", label: "Leads" },
  { path: "/customers", label: "Customers" },
  { path: "/schedule", label: "Schedule" },
  { path: "/employees", label: "Employees" },
  { path: "/payments", label: "Payments" },
  { path: "/payroll", label: "Payroll" },
  { path: "/messages", label: "Messages" },
  { path: "/reports", label: "Reports" },
  { path: "/settings", label: "Settings" }
];

const cleanerRoutes = [
  { path: "/", label: "Today" },
  { path: "/schedule", label: "Schedule" }
];

function normalizePath(hash = window.location.hash) {
  const path = hash.replace(/^#/, "").split("?")[0] || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function useHashRoute() {
  const [path, setPath] = useState(normalizePath);

  useEffect(() => {
    const update = () => setPath(normalizePath());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const navigate = useCallback((nextPath) => {
    if (normalizePath() === nextPath) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.location.hash = nextPath;
  }, []);

  return [path, navigate];
}

function AuthProvider({ children }) {
  const [state, setState] = useState({
    status: "loading",
    user: null,
    error: ""
  });

  const loadSession = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const user = await api.me();
      setState({ status: "ready", user, error: "" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: "ready", user: null, error: "" });
        return;
      }
      setState({
        status: "error",
        user: null,
        error: "Unable to reach Queen City Maid operations."
      });
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const value = useMemo(
    () => ({ ...state, setState, reload: loadSession }),
    [state, loadSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  return useContext(AuthContext);
}

function LoadingScreen() {
  return (
    <main className="center-screen" aria-busy="true">
      <img
        alt="Queen City Maid LLC"
        className="brand-logo loading-logo"
        src="/queen-city-maid-logo-transparent.png"
      />
      <p className="muted">Opening operations...</p>
    </main>
  );
}

function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const user = await api.login(email.trim(), password);
      auth.setState({ status: "ready", user, error: "" });
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 401
          ? "The email or password is incorrect."
          : requestError.message || "Sign in could not be completed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <img
            alt="Queen City Maid LLC"
            className="brand-logo login-logo"
            src="/queen-city-maid-logo-transparent.png"
          />
          <span>Operations</span>
        </div>

        <div className="login-heading">
          <p className="eyebrow">Secure access</p>
          <h1 id="login-title">Sign in</h1>
          <p>Use your company account to continue.</p>
        </div>

        {auth.status === "error" && (
          <div className="notice notice-error" role="alert">
            <div>
              <strong>Service unavailable</strong>
              <p>{auth.error}</p>
            </div>
            <button className="text-button" type="button" onClick={auth.reload}>
              Try again
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            autoComplete="username"
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />

          <div className="field-heading">
            <label htmlFor="password">Password</label>
            <button
              className="text-button"
              type="button"
              aria-controls="password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            autoComplete="current-password"
            id="password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type={showPassword ? "text" : "password"}
            value={password}
          />

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function NavLink({ route, currentPath, navigate, onNavigate }) {
  const active = route.path === currentPath;

  return (
    <a
      aria-current={active ? "page" : undefined}
      className={active ? "nav-link active" : "nav-link"}
      href={`#${route.path}`}
      onClick={(event) => {
        event.preventDefault();
        navigate(route.path);
        onNavigate?.();
      }}
    >
      <span className="nav-indicator" aria-hidden="true" />
      {route.label}
    </a>
  );
}

function UserBlock({ user, onLogout }) {
  const initial = (user.name || user.email || "Q").trim().charAt(0).toUpperCase();

  return (
    <div className="user-block">
      <span className="avatar" aria-hidden="true">{initial}</span>
      <span className="user-copy">
        <strong>{user.name || "Queen City Maid"}</strong>
        <small>{user.role === "cleaner" ? "Cleaner" : "Manager"}</small>
      </span>
      <button className="text-button" type="button" onClick={onLogout}>
        Sign out
      </button>
    </div>
  );
}

function AppShell({ user }) {
  const auth = useAuth();
  const [path, navigate] = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const routes = user.role === "cleaner" ? cleanerRoutes : managerRoutes;
  const permittedPath = routes.some((route) => route.path === path) ? path : "/";

  useEffect(() => {
    if (permittedPath !== path) navigate("/");
  }, [path, permittedPath, navigate]);

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      auth.setState({ status: "ready", user: null, error: "" });
      window.location.hash = "/";
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img
            alt="Queen City Maid LLC"
            className="brand-logo sidebar-logo"
            src="/queen-city-maid-logo-transparent.png"
          />
          <span>Operations</span>
        </div>
        <nav aria-label="Primary navigation">
          {routes.map((route) => (
            <NavLink
              currentPath={permittedPath}
              key={route.path}
              navigate={navigate}
              route={route}
            />
          ))}
        </nav>
        <UserBlock user={user} onLogout={handleLogout} />
      </aside>

      <header className="mobile-header">
        <div className="sidebar-brand">
          <img
            alt="Queen City Maid LLC"
            className="brand-logo mobile-logo"
            src="/queen-city-maid-logo-transparent.png"
          />
        </div>
        <button
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          className="menu-button"
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </header>

      {menuOpen && (
        <div className="mobile-menu" id="mobile-navigation">
          <nav aria-label="Mobile navigation">
            {routes.map((route) => (
              <NavLink
                currentPath={permittedPath}
                key={route.path}
                navigate={navigate}
                onNavigate={() => setMenuOpen(false)}
                route={route}
              />
            ))}
          </nav>
          <UserBlock user={user} onLogout={handleLogout} />
        </div>
      )}

      <main id="main-content" className="main-content" tabIndex="-1">
        <ProductPage path={permittedPath} user={user} />
      </main>
    </div>
  );
}

function App() {
  const auth = useAuth();
  if (auth.status === "loading") return <LoadingScreen />;
  if (!auth.user) return <LoginScreen />;
  return <AppShell user={auth.user} />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
