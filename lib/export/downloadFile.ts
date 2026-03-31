export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFilename(title: string): string {
  return title
    .replace(/[^\w\s가-힣-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}
