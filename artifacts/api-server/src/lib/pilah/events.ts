import { EventEmitter } from "node:events";
export const inboxEvents = new EventEmitter();
inboxEvents.setMaxListeners(20);
let timer: ReturnType<typeof setTimeout> | null = null;
export function notifyChange(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    inboxEvents.emit("change");
  }, 300);
  timer.unref();
}