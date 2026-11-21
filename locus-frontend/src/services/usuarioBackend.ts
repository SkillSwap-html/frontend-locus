import type { Usuario } from "@/types";
import { api, chamar } from "./api";

const STORAGE_KEY = "locus.backend.user.id";
const STORAGE_UID_KEY = "locus.backend.user.uid";

export function backendUserId(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Number(import.meta.env["VITE_BACKEND_USER_ID"] ?? "1");
}

export function limparUsuarioBackend(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_UID_KEY);
}

export async function sincronizarUsuario(usuario: Usuario): Promise<{ id: number; tipoUsuario?: string }> {
  const uidSalvo = localStorage.getItem(STORAGE_UID_KEY);
  if (uidSalvo && uidSalvo !== usuario.uid) {
    limparUsuarioBackend();
  }
  const body = {
    firebaseUid: usuario.uid,
    nome: usuario.nome,
    email: usuario.email,
    termosAceitos: true,
    tipoUsuario: "VIAJANTE",
  };
  try {
    const criado = await chamar<{ id: number; tipoUsuario?: string }>(() => api.post("/api/usuarios", body));
    localStorage.setItem(STORAGE_KEY, String(criado.id));
    localStorage.setItem(STORAGE_UID_KEY, usuario.uid);
    return criado;
  } catch {
    // A listagem de usuários é administrativa e não deve ser usada como
    // fallback de login. O POST é idempotente por Firebase UID; se falhar,
    // preserve a mensagem real para o usuário e não exponha a base inteira.
    throw new Error("Não foi possível preparar seu perfil. Atualize a página e entre novamente.");
  }
}
