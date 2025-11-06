// src/composables/useWs.js
import { inject, onBeforeUnmount } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ws } from "../utils/ws";

export function useWs({ url, on = {}, opts = {}, root = false } = {}) {
  const SockRoot = root ? inject("SockRoot", null) : null;
  const sock = root && SockRoot ? SockRoot : ws(url, { opts });

  // Bind events yang diminta komponen ini
  for (const [ev, fn] of Object.entries(on)) sock.on(ev, fn);

  const cleanup = () => {
    // Kalau root: cukup lepas event yang halaman ini pasang
    if (root && SockRoot) {
      for (const [ev, fn] of Object.entries(on)) sock.off(ev, fn);
    } else {
      // Kalau halaman sendiri: release ref (pool akan nutup kalau ref=0)
      sock.release();
    }
  };

  onBeforeUnmount(cleanup);
  onBeforeRouteLeave(cleanup);

  return sock; // { socket, on, off, emit, emitAck, release, ... }
}
