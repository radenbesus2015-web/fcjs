export function isExternalLink(href: string = ""): boolean {
  try {
    const u = new URL(href, window.location.origin);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}