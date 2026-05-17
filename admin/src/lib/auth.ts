const KEY = 'uniquebid_admin_token';
const USER_KEY = 'uniquebid_admin_user';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  coinBalance: number;
}

export function getToken(): string | null {
  return localStorage.getItem(KEY);
}

export function setToken(token: string) {
  localStorage.setItem(KEY, token);
}

export function getUser(): AdminUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AdminUser) : null;
}

export function setUser(user: AdminUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearToken() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthed(): boolean {
  const user = getUser();
  return Boolean(getToken() && user?.isAdmin);
}
