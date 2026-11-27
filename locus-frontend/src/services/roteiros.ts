import type { CategoriaOrcamento, ItemOrcamento, ItemRoteiro, Recomendacao, VersaoRoteiro, Viagem } from "@/types";
import { api, chamar } from "./api";
import { obterViagem } from "./viagens";
import { backendUserId } from "./usuarioBackend";

function categoriaBackend(categoria: CategoriaOrcamento | undefined): string {
  return ({
    passagem: "PASSAGEM",
    hospedagem: "HOSPEDAGEM",
    visitas: "VISITAS",
    alimentacao: "ALIMENTACAO",
    transporteLocal: "TRANSPORTE_LOCAL",
    extras: "EXTRAS",
  } as Record<string, string>)[String(categoria ?? "visitas")] ?? "VISITAS";
}

export async function salvarRoteiro(_viagemId: string, _itens: ItemRoteiro[]): Promise<Viagem> {
  throw new Error("Use os endpoints de dias e itens de roteiro para persistir as atividades.");
}

export async function criarVersao(viagemId: string, descricao = "Versão salva pelo viajante"): Promise<VersaoRoteiro> {
  return chamar<VersaoRoteiro>(() =>
    api.post<VersaoRoteiro>(`/api/versoes-roteiro/viagem/${viagemId}`, undefined, {
      params: { usuarioSolicitanteId: backendUserId(), descricao },
    }),
  );
}

export async function listarVersoes(viagemId: string): Promise<VersaoRoteiro[]> {
  return chamar<VersaoRoteiro[]>(() =>
    api.get<VersaoRoteiro[]>(`/api/versoes-roteiro/viagem/${viagemId}`, {
      params: { usuarioSolicitanteId: backendUserId() },
    }),
  );
}

export async function compararVersoes(versaoAntigaId: string, versaoNovaId: string): Promise<{ tipo: string; item: string; detalhe: string }[]> {
  return chamar(() => api.get(`/api/versoes-roteiro/comparar`, {
    params: { versaoAntigaId, versaoNovaId, usuarioSolicitanteId: backendUserId() },
  }));
}

export async function criarRoteiroInicial(viagem: Viagem): Promise<Viagem> {
  await garantirDiasRoteiro(viagem);
  return {
    ...viagem,
    roteiro: [],
  };
}

export async function adicionarRecomendacao(
  viagemId: string,
  recomendacao: Recomendacao,
): Promise<Viagem> {
  const usuarioId = backendUserId();
  const valor = Number(recomendacao.valor ?? 0);
  const possuiValor = Number.isFinite(valor) && valor > 0;
  const ehOferta = recomendacao.tipo === "voo" || recomendacao.tipo === "hospedagem";
  if (!ehOferta) {
    const viagem = await obterViagem(viagemId);
    await garantirDiasRoteiro(viagem);
    const dias = await chamar<Array<{ id: number; data?: string }>>(() =>
      api.get(`/api/dias-roteiro/viagem/${viagemId}`, { params: { usuarioId } }),
    );
    const datas = datasDaViagem(viagem);
    const indiceDia = Math.max(0, Math.min(datas.length - 1, (recomendacao.dia ?? 1) - 1));
    const dia = dias.find((item) => item.data === datas[indiceDia])
      ?? dias.sort((a, b) => String(a.data ?? "").localeCompare(String(b.data ?? "")))[indiceDia]
      ?? (await criarDia(viagemId, datas[indiceDia] ?? viagem.dataInicio));
    const itens = await chamar<Array<{ horarioInicio?: string; duracaoMinutos?: number }>>(() =>
      api.get(`/api/itens-roteiro/dia/${dia.id}`, { params: { usuarioId } }),
    );
    const duracaoMinutos = recomendacao.duracaoMinutos ?? 90;
    const horariosDoDia = itens.map((item) => {
      const [hora, minuto] = String(item.horarioInicio ?? "08:00").split(":").map(Number);
      return { inicio: (hora || 0) * 60 + (minuto || 0), duracao: Number(item.duracaoMinutos ?? 60) };
    });
    const horariosPossiveis = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]
      .map((horario) => {
        const [hora, minuto] = horario.split(":").map(Number);
        return (hora || 0) * 60 + (minuto || 0);
      });
    const horarioSolicitado = recomendacao.horario
      ? (() => {
          const [hora = 0, minuto = 0] = recomendacao.horario!.split(":").map(Number);
          return Number.isFinite(hora) && Number.isFinite(minuto) ? hora * 60 + minuto : undefined;
        })()
      : undefined;
    const horarioLivre = [...(horarioSolicitado != null ? [horarioSolicitado] : []), ...horariosPossiveis]
      .filter((horario, index, lista) => lista.indexOf(horario) === index)
      .find((inicio) => horariosDoDia.every((item) => {
        const fimExistente = item.inicio + item.duracao;
        return inicio + duracaoMinutos <= item.inicio || inicio >= fimExistente;
      }));
    if (horarioLivre == null) {
      throw new Error("Não há horário livre em intervalos de 2 horas neste dia. Escolha outro dia ou remova uma atividade.");
    }
    const horarioInicio = `${String(Math.floor(horarioLivre / 60)).padStart(2, "0")}:${String(horarioLivre % 60).padStart(2, "0")}`;
    await chamar(() =>
      api.post(
        `/api/itens-roteiro/dia/${dia.id}`,
        {
          titulo: recomendacao.titulo,
          horarioInicio,
          duracaoMinutos,
          custoEstimado: 0,
          observacoes: recomendacao.resumo,
          motivoRecomendacao: recomendacao.justificativa,
        },
        { params: { usuarioId } },
      ),
    );
  }
  if (possuiValor || (!ehOferta && recomendacao.categoria)) {
    await chamar(() => api.post(
      `/api/itens-orcamento/viagem/${viagemId}`,
      {
        categoria: categoriaBackend(recomendacao.categoria),
        descricao: recomendacao.titulo,
        valor: Math.max(0, valor),
      },
      { params: { usuarioSolicitanteId: usuarioId } },
    ));
  }

  const ehAtividadeTuristica = !ehOferta && (recomendacao.tipo === "lugar" || recomendacao.tipo === "atividade");
  if (ehAtividadeTuristica) {
    // O Places confirma o local, mas não fornece automaticamente o custo de
    // uma refeição nem o deslocamento do viajante. O Locus registra essas duas
    // parcelas separadamente como estimativas, para que o resumo e o PDF não
    // fiquem zerados e para que cada atração tenha seu próprio custo.
    const alimentacao = recomendacao.categoria === "alimentacao"
      ? 0
      : Math.max(0, Number(recomendacao.custos?.alimentacao?.valorBrl ?? 110));
    const transporteLocal = recomendacao.categoria === "transporteLocal"
      ? 0
      : Math.max(0, Number(recomendacao.custos?.transporteLocal?.valorBrl ?? 48));
    const extras = Math.max(0, Number(recomendacao.custos?.extras?.valorBrl ?? 30));
    const estimativas = [
      { categoria: "ALIMENTACAO", descricao: `${recomendacao.titulo} - alimentação estimada`, valor: alimentacao },
      { categoria: "TRANSPORTE_LOCAL", descricao: `${recomendacao.titulo} - transporte local estimado`, valor: transporteLocal },
      { categoria: "EXTRAS", descricao: `${recomendacao.titulo} - extras estimados`, valor: extras },
    ];
    for (const estimativa of estimativas) {
      if (estimativa.valor <= 0) continue;
      await chamar(() => api.post(
        `/api/itens-orcamento/viagem/${viagemId}`,
        estimativa,
        { params: { usuarioSolicitanteId: usuarioId } },
      ));
    }
  }
  return obterViagem(viagemId);
}

export async function excluirItemRoteiro(item: ItemRoteiro): Promise<void> {
  await chamar(() => api.delete(`/api/itens-roteiro/${item.id}`, {
    params: {
      usuarioId: backendUserId(),
      versaoEsperada: item.versao ?? 0,
    },
  }));
}

export async function excluirItemOrcamento(item: ItemOrcamento): Promise<void> {
  await chamar(() => api.delete(`/api/itens-orcamento/${item.id}`, {
    params: { usuarioSolicitanteId: backendUserId() },
  }));
}

export async function editarItemRoteiro(item: ItemRoteiro, dados: { titulo: string; horarioInicio: string; duracaoMinutos: number }): Promise<void> {
  await chamar(() => api.put(`/api/itens-roteiro/${item.id}`, {
    titulo: dados.titulo,
    horarioInicio: dados.horarioInicio,
    duracaoMinutos: dados.duracaoMinutos,
    custoEstimado: item.valorEstimado ?? 0,
    ...(item.observacoes ? { observacoes: item.observacoes } : {}),
    ...(item.motivo ? { motivoRecomendacao: item.motivo } : {}),
  }, {
    params: {
      usuarioId: backendUserId(),
      versaoEsperada: item.versao ?? 0,
      ...(item.lugarId != null ? { lugarId: item.lugarId } : {}),
    },
  }));
}

export async function criarLinkCompartilhamento(viagemId: string): Promise<string> {
  const resposta = await chamar<{ token: string }>(() => api.post(
    `/api/links-compartilhamento/viagem/${viagemId}`,
    undefined,
    { params: { usuarioSolicitanteId: backendUserId() } },
  ));
  return resposta.token;
}

async function criarDia(viagemId: string, data?: string): Promise<{ id: number }> {
  return chamar<{ id: number }>(() =>
    api.post(
      `/api/dias-roteiro/viagem/${viagemId}`,
      { data },
      { params: { usuarioId: backendUserId() } },
    ),
  );
}

function datasDaViagem(viagem: Viagem): string[] {
  const inicio = new Date(`${viagem.dataInicio}T12:00:00`);
  const fim = new Date(`${viagem.dataFim || viagem.dataInicio}T12:00:00`);
  const datas: string[] = [];
  for (let data = new Date(inicio); data <= fim && datas.length < 90; data.setDate(data.getDate() + 1)) {
    datas.push(data.toISOString().slice(0, 10));
  }
  return datas.length ? datas : [viagem.dataInicio];
}

async function garantirDiasRoteiro(viagem: Viagem): Promise<void> {
  const usuarioId = backendUserId();
  const existentes = await chamar<Array<{ id: number; data?: string }>>(() =>
    api.get(`/api/dias-roteiro/viagem/${viagem.id}`, { params: { usuarioId } }),
  );
  const existentesPorData = new Set(existentes.map((dia) => dia.data).filter(Boolean));
  await Promise.all(
    datasDaViagem(viagem)
      .filter((data) => !existentesPorData.has(data))
      .map((data) => chamar<{ id: number }>(() =>
        api.post(
          `/api/dias-roteiro/viagem/${viagem.id}`,
          { data },
          { params: { usuarioId } },
        ),
      )),
  );
}

export async function restaurarVersao(viagemId: string, versaoId: string): Promise<Viagem> {
  await chamar(() => api.post(
    `/api/versoes-roteiro/${versaoId}/restaurar`,
    undefined,
    { params: { viagemId, usuarioSolicitanteId: backendUserId() } },
  ));
  return obterViagem(viagemId);
}

export { obterViagem };
