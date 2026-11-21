import type { ItemRoteiro, Recomendacao, Viagem } from "@/types";
import { api, chamar } from "./api";
import { obterViagem } from "./viagens";
import { backendUserId } from "./usuarioBackend";

export async function salvarRoteiro(_viagemId: string, _itens: ItemRoteiro[]): Promise<Viagem> {
  throw new Error("Use os endpoints de dias e itens de roteiro para persistir as atividades.");
}

export async function criarVersao(viagemId: string): Promise<Viagem> {
  return chamar<Viagem>(() =>
    api.post<Viagem>(`/api/versoes-roteiro/viagem/${viagemId}`, undefined, {
      params: { usuarioSolicitanteId: backendUserId() },
    }),
  );
}

export async function criarRoteiroInicial(viagem: Viagem): Promise<Viagem> {
  const dia = await chamar<{ id: number }>(() =>
    api.post(
      `/api/dias-roteiro/viagem/${viagem.id}`,
      { data: viagem.dataInicio },
      { params: { usuarioId: backendUserId() } },
    ),
  );
  const item = await chamar<{
    id: number;
    titulo?: string;
    horarioInicio?: string;
    duracaoMinutos?: number;
  }>(() =>
    api.post(
      `/api/itens-roteiro/dia/${dia.id}`,
      {
        titulo: `Explorar ${viagem.destino}`,
        horarioInicio: "10:00",
        duracaoMinutos: 90,
        custoEstimado: 0,
        motivoRecomendacao: "Ponto de partida para personalizar o roteiro com a IA.",
      },
      { params: { usuarioId: backendUserId() } },
    ),
  );
  return {
    ...viagem,
    roteiro: [
      {
        id: String(item.id),
        dia: 1,
        titulo: item.titulo ?? `Explorar ${viagem.destino}`,
        inicio: item.horarioInicio ?? "10:00",
        duracaoMin: item.duracaoMinutos ?? 90,
        deslocamentoMin: 0,
        margemMin: 15,
        motivo: "Ponto de partida para personalizar o roteiro com a IA.",
      },
    ],
  };
}

export async function adicionarRecomendacao(
  viagemId: string,
  recomendacao: Recomendacao,
): Promise<Viagem> {
  const usuarioId = backendUserId();
  const dias = await chamar<Array<{ id: number }>>(() =>
    api.get(`/api/dias-roteiro/viagem/${viagemId}`, { params: { usuarioId } }),
  );
  const dia = dias[0] ?? (await criarDia(viagemId));
  await chamar(() =>
    api.post(
      `/api/itens-roteiro/dia/${dia.id}`,
      {
        titulo: recomendacao.titulo,
        horarioInicio: "10:00",
        duracaoMinutos: 90,
        custoEstimado: 0,
        observacoes: recomendacao.resumo,
        motivoRecomendacao: recomendacao.justificativa,
      },
      { params: { usuarioId } },
    ),
  );
  return obterViagem(viagemId);
}

async function criarDia(viagemId: string): Promise<{ id: number }> {
  const viagem = await obterViagem(viagemId);
  return chamar<{ id: number }>(() =>
    api.post(
      `/api/dias-roteiro/viagem/${viagemId}`,
      { data: viagem.dataInicio },
      { params: { usuarioId: backendUserId() } },
    ),
  );
}

export async function restaurarVersao(_viagemId: string, versaoId: string): Promise<Viagem> {
  throw new Error(
    `A versão ${versaoId} não pode ser restaurada automaticamente; compare e recrie os itens desejados.`,
  );
}

export { obterViagem };
