import type { Reserva } from "@/types";
import { api, chamar } from "./api";
import { backendUserId } from "./usuarioBackend";

export async function listarReservas(viagemId?: string): Promise<Reserva[]> {
  if (!viagemId) return [];
  return chamar(() =>
    api.get<Reserva[]>(`/api/reservas-simuladas/viagem/${viagemId}`, {
      params: { usuarioSolicitanteId: backendUserId() },
    }),
  );
}

export async function cancelarSimulacao(reservaId: string): Promise<void> {
  await chamar(() =>
    api.post(`/api/reservas-simuladas/${reservaId}/cancelar`, undefined, {
      params: { usuarioSolicitanteId: backendUserId() },
    }),
  );
}

export async function confirmarRoteiro(
  viagemId: string,
  _total: number,
): Promise<{
  reserva: Reserva;
  relatorio: import("@/types").Relatorio;
}> {
  const usuarioSolicitanteId = backendUserId();
  const existentes = await listarReservas(viagemId).catch(() => []);
  const ativa = [...existentes]
    .reverse()
    .find((item) => !String(item.status).toLowerCase().includes("cancelada"));
  let reserva = ativa ?? await chamar<Reserva>(() =>
    api.post(`/api/reservas-simuladas/viagem/${viagemId}`, undefined, {
      params: { usuarioSolicitanteId },
    }),
  );
  let status = String(reserva.status).toLowerCase();
  if (status.includes("confirmada")) {
    const { gerarRelatorio } = await import("./relatorios");
    return { reserva, relatorio: await gerarRelatorio(reserva) };
  }
  if (status.includes("rascunho")) {
    reserva = await chamar<Reserva>(() =>
      api.post(`/api/reservas-simuladas/${reserva.id}/preparar-pagamento`, undefined, {
        params: { usuarioSolicitanteId },
      }),
    );
    status = String(reserva.status).toLowerCase();
  }
  if (status.includes("aguardando")) {
    const pagamento = await chamar<{ id: number; status?: string }>(() =>
      api.post(`/api/pagamentos-simulados/reserva/${reserva.id}/iniciar`, undefined, {
        params: { usuarioSolicitanteId },
      }),
    );
    status = String(pagamento.status).toLowerCase();
    if (!status.includes("conclu")) {
      await chamar(() =>
        api.post(`/api/pagamentos-simulados/${pagamento.id}/concluir`, undefined, {
          params: { usuarioSolicitanteId },
        }),
      );
    }
  }
  const confirmada = await chamar<Reserva>(() =>
    api.post(`/api/reservas-simuladas/${reserva.id}/confirmar`, undefined, {
      params: { usuarioSolicitanteId },
    }),
  );
  const { gerarRelatorio } = await import("./relatorios");
  return { reserva: confirmada, relatorio: await gerarRelatorio(confirmada) };
}
