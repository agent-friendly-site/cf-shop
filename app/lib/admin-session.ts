/** Shared admin session helpers (not an island — safe to import from islands). */
import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./api";

type AuthState = { ready: boolean; authed: boolean };
type AuthListener = (state: AuthState) => void;

const AUTH_EVENT = "af-admin-auth";
let cache: AuthState = { ready: false, authed: false };
const listeners = new Set<AuthListener>();

function emit(state: AuthState) {
  cache = state;
  for (const l of listeners) l(state);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: state }));
  }
}

export function getAdminAuthCache() {
  return cache;
}

export function publishAdminAuth(state: AuthState) {
  emit(state);
}

export function subscribeAdminAuth(listener: AuthListener) {
  listeners.add(listener);
  listener(cache);
  const onWindow = (e: Event) => {
    const detail = (e as CustomEvent<AuthState>).detail;
    if (detail) listener(detail);
  };
  if (typeof window !== "undefined") {
    window.addEventListener(AUTH_EVENT, onWindow);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener(AUTH_EVENT, onWindow);
    }
  };
}

export function useAdminSession(shop: string) {
  const [ready, setReady] = useState(cache.ready);
  const [authed, setAuthed] = useState(cache.authed);

  const refreshMe = useCallback(async () => {
    const res = await adminFetch(shop, "/me");
    const next = { ready: true, authed: res.ok };
    publishAdminAuth(next);
    return res.ok;
  }, [shop]);

  useEffect(
    () =>
      subscribeAdminAuth((s) => {
        setReady(s.ready);
        setAuthed(s.authed);
      }),
    [],
  );

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  async function logout() {
    await adminFetch(shop, "/logout", { method: "POST" });
    publishAdminAuth({ ready: true, authed: false });
  }

  return {
    ready,
    authed,
    logout,
    refreshMe,
  };
}

export function tabFromSearch(): string {
  if (typeof window === "undefined") return "orders";
  return new URLSearchParams(window.location.search).get("tab") || "orders";
}

export function orderIdFromSearch(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("order");
}

export function statusFromSearch(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("status") || "";
}

export function setAdminSearch(patch: Record<string, string | null | undefined>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v == null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.pushState({}, "", url.toString());
  window.dispatchEvent(new Event("af-admin-nav"));
}
