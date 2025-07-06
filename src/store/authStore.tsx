import {
  useState,
  useEffect,
  createContext,
  useContext,
  ReactNode,
} from "react";
import { AuthState, User } from "@/types";
import {
  createUserAccount,
  signInUser,
  signOutUser,
  onAuthStateChange,
} from "@/services/firebase";

interface AuthContextType extends AuthState {
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  register: (
    email: string,
    password: string,
    username: string,
    fullName: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

const useAuthStore = () => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    console.log("Setting up Firebase auth state listener...");
    // Listen to Firebase auth state changes
    const unsubscribe = onAuthStateChange((user) => {
      console.log("Auth state changed:", user?.id || "null");
      setState({
        user,
        isAuthenticated: !!user,
        isLoading: false,
      });
    });

    return () => {
      console.log("Cleaning up Firebase auth state listener");
      unsubscribe();
    };
  }, []);

  const login = async (
    email: string,
    password: string,
  ): Promise<{ success: boolean; error?: string }> => {
    console.log("Firebase login attempt:", email);
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const result = await signInUser(email, password);
      console.log("Firebase login result:", result);

      if (result.success && result.user) {
        setState({
          user: result.user,
          isAuthenticated: true,
          isLoading: false,
        });
        return { success: true };
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return { success: false, error: result.error || "Login failed" };
      }
    } catch (error: any) {
      console.error("Firebase login error:", error);
      setState((prev) => ({ ...prev, isLoading: false }));
      return {
        success: false,
        error: error.message || "Login failed. Please try again.",
      };
    }
  };

  const register = async (
    email: string,
    password: string,
    username: string,
    fullName: string,
  ): Promise<{ success: boolean; error?: string }> => {
    console.log("Firebase register attempt:", { email, username, fullName });
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const result = await createUserAccount(
        email,
        password,
        username,
        fullName,
      );
      console.log("Firebase register result:", result);

      if (result.success && result.user) {
        setState({
          user: result.user,
          isAuthenticated: true,
          isLoading: false,
        });
        return { success: true };
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
        return { success: false, error: result.error || "Registration failed" };
      }
    } catch (error: any) {
      console.error("Firebase register error:", error);
      setState((prev) => ({ ...prev, isLoading: false }));
      return {
        success: false,
        error: error.message || "Registration failed. Please try again.",
      };
    }
  };

  const logout = async () => {
    console.log("Firebase logout attempt");
    try {
      await signOutUser();
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
      console.log("Firebase logout successful");
    } catch (error) {
      console.error("Firebase logout error:", error);
    }
  };

  const updateUser = (user: User) => {
    console.log("Updating user in Firebase context:", user);
    setState((prev) => ({ ...prev, user: { ...user } }));
  };

  return {
    ...state,
    login,
    register,
    logout,
    updateUser,
  };
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const auth = useAuthStore();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};
