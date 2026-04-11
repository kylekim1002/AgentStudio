export const INBOX_SYNC_EVENT = "cyj:inbox-sync";
const INBOX_SYNC_STORAGE_KEY = "cyj:inbox-sync";

export type InboxSyncReason =
  | "lesson_saved"
  | "lesson_reviewed"
  | "lesson_reassigned"
  | "lesson_favorited"
  | "lesson_commented";

export function dispatchInboxSync(reason: InboxSyncReason) {
  if (typeof window === "undefined") return;
  const payload = {
    reason,
    at: new Date().toISOString(),
  };
  window.dispatchEvent(
    new CustomEvent(INBOX_SYNC_EVENT, {
      detail: payload,
    })
  );
  try {
    window.localStorage.setItem(INBOX_SYNC_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

export function subscribeInboxSync(onSync: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  function handleCustomEvent() {
    onSync();
  }

  function handleStorage(event: StorageEvent) {
    if (event.key !== INBOX_SYNC_STORAGE_KEY || !event.newValue) return;
    onSync();
  }

  window.addEventListener(INBOX_SYNC_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(INBOX_SYNC_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorage);
  };
}
