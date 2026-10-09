// Liens d'invitation : `https://hôte/?code=ABCD` ouvre directement la partie.

const CODE_PARAM = "code";
// Codes générés par le serveur (sans 0/O ni 1/I).
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const PSEUDO_KEY = "puzzle:pseudo";

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function inviteLink(code: string): string {
  return `${location.origin}/?${CODE_PARAM}=${encodeURIComponent(code)}`;
}

// Code présent dans l'URL de la page (lien d'invitation).
export function codeFromUrl(): string {
  const raw = new URLSearchParams(location.search).get(CODE_PARAM) ?? "";
  return normalizeCode(raw);
}

// Reflète la partie courante dans l'URL (copier la barre d'adresse = inviter,
// recharger = revenir dans la partie).
export function setUrlCode(code: string | null): void {
  const url = code ? `/?${CODE_PARAM}=${code}` : "/";
  if (location.pathname + location.search !== url) history.replaceState(null, "", url);
}

export function savedPseudo(): string {
  try {
    return localStorage.getItem(PSEUDO_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePseudo(pseudo: string): void {
  try {
    localStorage.setItem(PSEUDO_KEY, pseudo);
  } catch {
    /* stockage indisponible (navigation privée) */
  }
}

// Copie dans le presse-papiers. L'API Clipboard n'existe qu'en contexte
// sécurisé (HTTPS) : repli sur execCommand sinon.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli ci-dessous */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// Partage natif (mobile) si disponible, sinon copie du lien.
// Renvoie "shared", "copied" ou "failed".
export async function shareInvite(code: string): Promise<"shared" | "copied" | "failed"> {
  const url = inviteLink(code);
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: "Puzzle Multiplayer", text: `Rejoins ma partie de puzzle (code ${code})`, url });
      return "shared";
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return "failed";
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}
