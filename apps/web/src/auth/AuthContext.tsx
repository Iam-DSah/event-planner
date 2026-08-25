import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  getMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  setOnUnauthorized,
  type User,
} from "../api/client.js";

/**
 * Three states, not `User | null`. With two, `null` means both "the boot /me
 * has not answered yet" and "logged out", so a logged-in user who refreshes
 * sees the login page flash before the dashboard — and once routing lands,
 * that same ambiguity redirects them away from the page they asked for.
 */
type AuthState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: User }
  | { status: "anonymous"; user: null };

interface AuthContextValue {
  status: AuthState["status"];
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
  });

  const setAnonymous = useCallback(() => {
    setState({ status: "anonymous", user: null });
  }, []);

  const setAuthenticated = useCallback((user: User) => {
    setState({ status: "authenticated", user });
  }, []);

  useEffect(() => {
    setOnUnauthorized(setAnonymous);

    return () => {
      setOnUnauthorized(null);
    };
  }, [setAnonymous]);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentUser(): Promise<void> {
      try {
        const user = await getMe();

        if (!cancelled) {
          setAuthenticated(user);
        }
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError) {
            console.warn("Failed to load current user:", {
              status: error.status,
              code: error.code,
            });
          } else {
            console.warn("Failed to load current user:", error);
          }

          // Deliberate limitation: an API failure during boot is treated the
          // same as an unauthenticated session.
          setAnonymous();
        }
      }
    }

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [setAnonymous, setAuthenticated]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      setAuthenticated(await apiLogin({ email, password }));
    },
    [setAuthenticated],
  );

  const register = useCallback(
    async (name: string, email: string, password: string): Promise<void> => {
      setAuthenticated(await apiRegister({ name, email, password }));
    },
    [setAuthenticated],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } finally {
      // The UI must become anonymous even if the server request fails because
      // of a network error.
      setAnonymous();
    }
  }, [setAnonymous]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      login,
      register,
      logout,
    }),
    [state, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
