import type { Relatorio, Reserva } from "@/types";
import { api, chamar } from "./api";
import { backendUserId } from "./usuarioBackend";

function normalizarRelatorio(raw: Record<string, unknown>, viagemId: string): Relatorio {
  return {
    id: String(raw["id"] ?? ""),
    reservaId: String(raw["reservaId"] ?? ""),
    viagemId,
    protocolo: String(raw["protocoloReserva"] ?? raw["protocolo"] ?? ""),
    geradoEm: String(raw["dataGeracao"] ?? raw["geradoEm"] ?? ""),
    ...(String(raw["nomeArquivo"] ?? "") ? { nomeArquivo: String(raw["nomeArquivo"]) } : {}),
  };
}

export async function listarRelatorios(viagemId?: string): Promise<Relatorio[]> {
  if (!viagemId) return [];
  const reservas = await chamar<Reserva[]>(() =>
    api.get(`/api/reservas-simuladas/viagem/${viagemId}`, {
      params: { usuarioSolicitanteId: backendUserId() },
    }),
  );
  // Relatórios só existem depois da confirmação da simulação. Não consulte
  // /relatorios/reserva para rascunhos ou pagamentos pendentes, pois o backend
  // responde 400 enquanto ainda não há PDF para aquela reserva.
  const reservasConfirmadas = reservas.filter((reserva) =>
    String(reserva.status).toLowerCase().includes("confirmada"),
  );
  const relatorios = await Promise.all(
    reservasConfirmadas.map((reserva) =>
      chamar<Record<string, unknown>>(() =>
        // A geração é idempotente: se o relatório já existir, o backend o
        // devolve; se faltar, ele é criado para a reserva confirmada.
        api.post(`/api/relatorios/reserva/${reserva.id}`, undefined, {
          params: { usuarioSolicitanteId: backendUserId() },
        }),
      )
        .then((raw) => normalizarRelatorio(raw, viagemId))
        .catch(() => null),
    ),
  );
  return relatorios.filter((item): item is Relatorio => Boolean(item));
}

export async function gerarRelatorio(reserva: Reserva): Promise<Relatorio> {
  const raw = await chamar<Record<string, unknown>>(() =>
    api.post(`/api/relatorios/reserva/${reserva.id}`, undefined, {
      params: { usuarioSolicitanteId: backendUserId() },
    }),
  );
  const viagem = (reserva as unknown as Record<string, unknown>)["viagem"] as
    Record<string, unknown> | undefined;
  return normalizarRelatorio(raw, reserva.viagemId || String(viagem?.["id"] ?? ""));
}

export async function baixarRelatorio(rel: Relatorio): Promise<Blob> {
  const { data } = await api.get<Blob>(`/api/relatorios/${rel.id}/pdf`, {
    responseType: "blob",
    params: { usuarioSolicitanteId: backendUserId() },
  });
  return data;
}
