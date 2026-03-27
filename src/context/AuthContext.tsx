import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { AppUser, UserRole } from '../types';

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

const defaultUserData = {
  role: 'tourist' as UserRole,
  locale: 'en' as const,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const docRef = doc(db, 'users', firebaseUser.uid);
      const snapshot = await getDoc(docRef);
      const userData = snapshot.exists() ? snapshot.data() : null;
      const displayName = firebaseUser.displayName || userData?.displayName || 'Qatar Traveler';
      const role = (userData?.role as UserRole) || defaultUserData.role;
      const locale = (userData?.locale as 'en' | 'ar') || defaultUserData.locale;

      setUser({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName,
        role,
        locale,
      });
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  async function login(email: string, password: string) {
    setLoading(true);
    await signInWithEmailAndPassword(auth, email, password);
    setLoading(false);
  }

  async function register(email: string, password: string, displayName: string, role: UserRole) {
    setLoading(true);
    const credentials = await createUserWithEmailAndPassword(auth, email, password);
    if (credentials.user) {
      await updateProfile(credentials.user, { displayName });
      await setDoc(doc(db, 'users', credentials.user.uid), {
        displayName,
        role,
        locale: 'en',
      });
    }
    setLoading(false);
  }

  async function logout() {
    setLoading(true);
    await signOut(auth);
    setUser(null);
    setLoading(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
