import type { Usuario } from "@/types";

/** Firebase Authentication. A local/demo session is intentionally not used. */
const firebaseConfig = {
  apiKey: import.meta.env["VITE_FIREBASE_API_KEY"] as string | undefined,
  authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"] as string | undefined,
  projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"] as string | undefined,
  appId: import.meta.env["VITE_FIREBASE_APP_ID"] as string | undefined,
  storageBucket: import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"] as string | undefined,
  messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"] as string | undefined,
};
export const firebaseAtivo = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
);

export class AuthError extends Error {
  constructor(
    public codigo:
      | "credencial-invalida"
      | "token-expirado"
      | "indisponivel"
      | "email-em-uso"
      | "senha-fraca"
      | "outro",
    message: string,
  ) {
    super(message);
  }
}

function traduzir(code: string): AuthError {
  if (
    [
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/user-not-found",
      "auth/invalid-email",
    ].includes(code)
  )
    return new AuthError("credencial-invalida", "E-mail ou senha incorretos.");
  if (code === "auth/id-token-expired" || code === "auth/user-token-expired")
    return new AuthError("token-expirado", "Sua sessão expirou. Entre novamente.");
  if (code === "auth/network-request-failed" || code === "auth/internal-error")
    return new AuthError(
      "indisponivel",
      "O serviço de login está indisponível no momento. Tente em instantes.",
    );
  if (code === "auth/email-already-in-use")
    return new AuthError("email-em-uso", "Este e-mail já tem cadastro.");
  if (code === "auth/weak-password")
    return new AuthError("senha-fraca", "Use uma senha com pelo menos 6 caracteres.");
  return new AuthError("outro", "Não foi possível concluir. Tente novamente.");
}

async function fb() {
  const { initializeApp, getApps } = await import("firebase/app");
  const auth = await import("firebase/auth");
  const app = getApps()[0] ?? initializeApp(firebaseConfig as { apiKey: string });
  return { auth, instance: auth.getAuth(app) };
}

export async function usuarioAtual(): Promise<Usuario | null> {
  if (typeof window === "undefined") return null;
  if (!firebaseAtivo) return null;
  const { auth, instance } = await fb();
  await instance.authStateReady();
  // Depois do signInWithRedirect, o resultado da conta escolhida fica
  // disponível nesta chamada. Sem getRedirectResult, a aplicação podia
  // voltar do Google e continuar mostrando a tela de login.
  const resultadoRedirect = await auth.getRedirectResult(instance);
  const u = resultadoRedirect?.user ?? instance.currentUser;
  return u
    ? {
        uid: u.uid,
        nome: u.displayName ?? u.email ?? "Viajante",
        email: u.email ?? "",
        papel: "viajante",
      }
    : null;
}

export async function getIdToken(forceRefresh = false): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!firebaseAtivo) return null;
  const { instance } = await fb();
  // The visual app can already be rendered while Firebase is still restoring
  // the session. Waiting here prevents the first chat request from being sent
  // without the bearer token and being reported as a network failure.
  await instance.authStateReady();
  const currentUser = instance.currentUser;
  return currentUser ? await currentUser.getIdToken(forceRefresh) : null;
}

export async function entrarComGoogle(): Promise<Usuario | null> {
  if (!firebaseAtivo)
    throw new AuthError("indisponivel", "Configure o Firebase para usar o login com Google.");
  try {
    const { auth, instance } = await fb();
    const provider = new auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    // O fluxo por popup gera avisos de Cross-Origin-Opener-Policy no Chrome
    // e pode ser bloqueado pelo navegador. O redirecionamento retorna à mesma
    // página e usuarioAtual() restaura a sessão após o Firebase concluir.
    await auth.signInWithRedirect(instance, provider);
    return null;
  } catch (e) {
    throw traduzir((e as { code?: string }).code ?? "");
  }
}

export async function cadastrar(nome: string, email: string, senha: string): Promise<Usuario> {
  if (!firebaseAtivo)
    throw new AuthError("indisponivel", "Configure o Firebase para cadastrar uma conta.");
  try {
    const { auth, instance } = await fb();
    const cred = await auth.createUserWithEmailAndPassword(instance, email, senha);
    await auth.updateProfile(cred.user, { displayName: nome });
    return { uid: cred.user.uid, nome, email, papel: "viajante" };
  } catch (e) {
    throw traduzir((e as { code?: string }).code ?? "");
  }
}

export async function recuperarAcesso(email: string): Promise<void> {
  if (!firebaseAtivo)
    throw new AuthError("indisponivel", "Configure o Firebase para recuperar o acesso.");
  try {
    const { auth, instance } = await fb();
    await auth.sendPasswordResetEmail(instance, email);
  } catch (e) {
    throw traduzir((e as { code?: string }).code ?? "");
  }
}

export async function sair(): Promise<void> {
  if (!firebaseAtivo) return;
  const { auth, instance } = await fb();
  await auth.signOut(instance);
}
