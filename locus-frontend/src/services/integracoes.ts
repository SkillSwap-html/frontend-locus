import type { CategoriaOrcamento, Lugar, MensagemAssistente, OfertaHotel, OfertaVoo } from "@/types";
import { api, chamar, LocusError } from "./api";
import { uid } from "./ids";

/** O navegador chama apenas o backend; as chaves dos provedores nunca ficam aqui. */
const BASE = "/api/integracoes";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const texto = (value: unknown) => (typeof value === "string" ? value : "");
const numero = (value: unknown, fallback = 0) =>
  typeof value === "number" ? value : Number(value ?? fallback) || fallback;
const objeto = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

function rotuloTipoLugar(tipo: unknown): string {
  const rotulos: Record<string, string> = {
    tourist_attraction: "Ponto turístico",
    historical_landmark: "Lugar histórico",
    museum: "Museu",
    art_gallery: "Galeria de arte",
    park: "Parque",
    beach: "Praia",
    restaurant: "Restaurante",
    cafe: "Café",
    lodging: "Hospedagem",
    hotel: "Hotel",
    church: "Igreja",
    shopping_mall: "Shopping",
    natural_feature: "Atração natural",
  };
  const valor = texto(tipo);
  return rotulos[valor] || valor.replaceAll("_", " ") || "Ponto de interesse";
}

function normalizarLugar(raw: unknown): Lugar {
  const value = objeto(raw);
  const displayName = objeto(value.displayName);
  const location = objeto(value.location);
  const opening = objeto(value.currentOpeningHours);
  const types = Array.isArray(value.types) ? value.types : [];
  const lugar: Lugar = {
    placeId: texto(value.id) || texto(value.name),
    nome: texto(displayName.text) || texto(value.name) || "Lugar sem nome",
    endereco: texto(value.formattedAddress) || texto(value.shortFormattedAddress),
    categoria: rotuloTipoLugar(types[0]),
    tipos: types.map(texto).filter(Boolean),
    lat: numero(location.latitude),
    lng: numero(location.longitude),
    descricao: texto(value.editorialSummary),
    fonte: "Google Places",
    consultadoEm: new Date().toISOString(),
    demonstrativo: false,
  };
  if (typeof value.rating === "number") lugar.avaliacao = value.rating;
  if (typeof value.priceLevel === "number") lugar.nivelPreco = value.priceLevel;
  if (typeof opening.openNow === "boolean") lugar.aberto = opening.openNow;
  return lugar;
}

type CoordenadaDestino = { lat: number; lng: number; nome: string };

const DESTINOS_CONHECIDOS: Record<string, CoordenadaDestino> = {
  curacao: { lat: 12.1696, lng: -68.9900, nome: "Curaçao" },
  cur: { lat: 12.1696, lng: -68.9900, nome: "Curaçao" },
  willemstad: { lat: 12.1090, lng: -68.9335, nome: "Willemstad" },
  salvador: { lat: -12.9777, lng: -38.5016, nome: "Salvador" },
  ssa: { lat: -12.9111, lng: -38.3313, nome: "Salvador" },
  lisboa: { lat: 38.7223, lng: -9.1393, nome: "Lisboa" },
  lis: { lat: 38.7742, lng: -9.1342, nome: "Lisboa" },
  madeira: { lat: 32.7607, lng: -16.9595, nome: "Ilha da Madeira" },
  funchal: { lat: 32.6669, lng: -16.9241, nome: "Funchal" },
  fnc: { lat: 32.6979, lng: -16.7745, nome: "Ilha da Madeira" },
  "rio de janeiro": { lat: -22.9068, lng: -43.1729, nome: "Rio de Janeiro" },
  gig: { lat: -22.8099, lng: -43.2506, nome: "Rio de Janeiro" },
  "sao paulo": { lat: -23.5505, lng: -46.6333, nome: "São Paulo" },
  gru: { lat: -23.4356, lng: -46.4731, nome: "São Paulo" },
  recife: { lat: -8.0476, lng: -34.8770, nome: "Recife" },
  rec: { lat: -8.1268, lng: -34.9230, nome: "Recife" },
  fortaleza: { lat: -3.7319, lng: -38.5267, nome: "Fortaleza" },
  for: { lat: -3.7763, lng: -38.5326, nome: "Fortaleza" },
  natal: { lat: -5.7945, lng: -35.2110, nome: "Natal" },
  nat: { lat: -5.7681, lng: -35.3760, nome: "Natal" },
};

const SUGESTOES_LOCAIS = [
  { id: "local-salvador", texto: "Salvador, Bahia, Brasil" },
  { id: "local-curacao", texto: "Curaçao, Caribe" },
  { id: "local-willemstad", texto: "Willemstad, Curaçao" },
  { id: "local-lisboa", texto: "Lisboa, Portugal" },
  { id: "local-madeira", texto: "Ilha da Madeira, Portugal" },
  { id: "local-rio", texto: "Rio de Janeiro, Brasil" },
  { id: "local-sao-paulo", texto: "São Paulo, Brasil" },
  { id: "local-recife", texto: "Recife, Pernambuco, Brasil" },
  { id: "local-fortaleza", texto: "Fortaleza, Ceará, Brasil" },
  { id: "local-natal", texto: "Natal, Rio Grande do Norte, Brasil" },
];

function normalizarBusca(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function destinoParaExemplo(consulta: string): CoordenadaDestino {
  const normalizada = normalizarBusca(consulta);
  const encontrado = Object.entries(DESTINOS_CONHECIDOS)
    .filter(([chave]) => chave.length > 3)
    .find(([chave]) => normalizada.includes(chave));
  if (encontrado) return encontrado[1];
  const codigo = normalizada.trim();
  if (/^[a-z]{3}$/.test(codigo) && DESTINOS_CONHECIDOS[codigo]) return DESTINOS_CONHECIDOS[codigo];
  const codigoNaConsulta = normalizada.match(/\b([a-z]{3})\b/)?.[1];
  if (codigoNaConsulta && DESTINOS_CONHECIDOS[codigoNaConsulta]) return DESTINOS_CONHECIDOS[codigoNaConsulta];

  const trecho = consulta.match(/\bem\s+([^,.;]+(?:,[^.;]+)?)/i)?.[1]?.trim();
  return {
    // Não existe uma coordenada correta para um destino desconhecido ou
    // informado apenas como país. Usar o centro do Brasil aqui fazia locais
    // de outros países aparecerem no mapa em uma posição errada.
    lat: 0,
    lng: 0,
    nome: trecho || "destino informado",
  };
}

function lugaresDemonstrativos(consulta: string): Lugar[] {
  const destino = destinoParaExemplo(consulta);
  const textoConsulta = normalizarBusca(consulta);
  const querHospedagem = /hotel|hospedagem|pousada|hostel|resort|onde ficar/.test(textoConsulta);
  const nomes = querHospedagem
    ? ["Hospedagem central", "Pousada próxima à praia", "Hotel confortável no destino", "Hostel bem localizado"]
    : ["Praia ou atração natural próxima", "Ponto turístico do centro", "Restaurante recomendado na região", "Museu ou atração cultural"];
  const categorias = querHospedagem
    ? ["Hotel", "Pousada", "Hotel", "Hostel"]
    : ["Praia", "Ponto turístico", "Restaurante", "Museu"];
  const possuiCoordenadas = destino.lat !== 0 || destino.lng !== 0;
  const agora = new Date().toISOString();
  return nomes.map((nome, index) => ({
    placeId: `demo-${normalizarBusca(destino.nome).replace(/[^a-z0-9]+/g, "-")}-${index}`,
    nome: `${nome} em ${destino.nome}`,
    endereco: possuiCoordenadas
      ? `${destino.nome} · localização de exemplo para planejamento`
      : `${destino.nome} · confirme a localização no Google Maps`,
    categoria: categorias[index]!,
    lat: destino.lat + (index - 1.5) * 0.012,
    lng: destino.lng + (index % 2 === 0 ? 1 : -1) * (0.014 + index * 0.003),
    fonte: "Exemplo de planejamento · Google Places temporariamente limitado",
    consultadoEm: agora,
    demonstrativo: true,
  }));
}

function sugestoesLocaisFallback(valor: string): { id: string; texto: string }[] {
  const consulta = normalizarBusca(valor);
  const conhecidas = SUGESTOES_LOCAIS
    .filter((item) => normalizarBusca(item.texto).includes(consulta))
    .slice(0, 6);
  if (conhecidas.length) return conhecidas;

  // Mesmo com o Places temporariamente limitado, a pessoa ainda pode
  // escolher o texto digitado e seguir para a busca/planejamento local.
  const textoDigitado = valor.trim();
  return textoDigitado
    ? [{ id: `local-input-${consulta.replace(/[^a-z0-9]+/g, "-")}`, texto: textoDigitado }]
    : [];
}

const IMAGENS_HOSPEDAGEM_EXEMPLO = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=900&q=80",
];

function hospedagensExemplo(params: Record<string, string | number>): OfertaHotel[] {
  const cidade = texto(params["cityName"]) || texto(params["cityCode"]) || "destino informado";
  const entrada = texto(params["checkInDate"]);
  const saida = texto(params["checkOutDate"]);
  const adultos = Math.max(1, numero(params["adults"], 1));
  const quartos = Math.max(1, numero(params["roomQuantity"], 1));
  const noites = entrada && saida
    ? Math.max(1, Math.floor((new Date(`${saida}T12:00:00`).getTime() - new Date(`${entrada}T12:00:00`).getTime()) / 86400000))
    : 1;
  const destino = destinoParaExemplo(cidade);
  const agora = new Date().toISOString();
  const opcoes = [
    ["Locus Central Hotel", 320],
    ["Rota Verde Suites", 420],
    ["Maré Alta Resort", 580],
  ] as const;
  return opcoes.map(([hotel, diaria], index) => ({
    id: `hotel-exemplo-${normalizarBusca(cidade).replace(/[^a-z0-9]+/g, "-")}-${index}`,
    hotel: `${hotel} · ${destino.nome}`,
    quarto: `${adultos} hóspede(s) · ${quartos} quarto(s)`,
    hospedes: adultos,
    quartos,
    noites,
    checkin: entrada,
    checkout: saida,
    regime: "Exemplo com café da manhã",
    politica: "Consulte disponibilidade antes de reservar",
    moeda: "BRL",
    taxas: 0,
    preco: diaria * noites * quartos,
    imagemUrl: IMAGENS_HOSPEDAGEM_EXEMPLO[index]!,
    latitude: destino.lat + (index - 1) * 0.008,
    longitude: destino.lng + (index - 1) * 0.009,
    endereco: `${destino.nome} · endereço ilustrativo para planejamento`,
    fonte: "Exemplo de planejamento",
    consultadoEm: agora,
    historico: [],
  }));
}

function textoGemini(raw: unknown): string {
  const root = objeto(raw);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choiceMessage = objeto(objeto(choices[0]).message);
  const choiceText = texto(choiceMessage.content);
  if (choiceText) return choiceText;
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const first = objeto(candidates[0]);
  const content = objeto(first.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts
    .map((part: Json) => texto(objeto(part).text))
    .filter(Boolean)
    .join("\n");
}

function decodificarStringJson(valor: string): string {
  return valor
    .replace(/\\u([0-9a-f]{4})/gi, (_match, codigo: string) => String.fromCharCode(parseInt(codigo, 16)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\(["\\/])/g, "$1");
}

function extrairStringCampo(conteudo: string, chave: string): string {
  const inicioCampo = conteudo.indexOf(`"${chave}"`);
  if (inicioCampo < 0) return "";
  const doisPontos = conteudo.indexOf(":", inicioCampo);
  const inicioAspas = conteudo.indexOf('"', doisPontos);
  if (doisPontos < 0 || inicioAspas < 0) return "";
  let valor = "";
  let escapado = false;
  for (let indice = inicioAspas + 1; indice < conteudo.length; indice += 1) {
    const caractere = conteudo[indice]!;
    if (escapado) {
      valor += `\\${caractere}`;
      escapado = false;
    } else if (caractere === "\\") {
      escapado = true;
    } else if (caractere === '"') {
      return decodificarStringJson(valor);
    } else {
      valor += caractere;
    }
  }
  return decodificarStringJson(valor);
}

function extrairStringsArray(conteudo: string, chave: string): string[] {
  const inicioCampo = conteudo.indexOf(`"${chave}"`);
  const inicioLista = inicioCampo >= 0 ? conteudo.indexOf("[", inicioCampo) : -1;
  if (inicioLista < 0) return [];
  const valores: string[] = [];
  let valor = "";
  let dentroDeString = false;
  let escapado = false;
  for (let indice = inicioLista + 1; indice < conteudo.length; indice += 1) {
    const caractere = conteudo[indice]!;
    if (!dentroDeString) {
      if (caractere === '"') {
        dentroDeString = true;
        valor = "";
      } else if (caractere === "]") {
        break;
      }
      continue;
    }
    if (escapado) {
      valor += `\\${caractere}`;
      escapado = false;
    } else if (caractere === "\\") {
      escapado = true;
    } else if (caractere === '"') {
      valores.push(decodificarStringJson(valor));
      dentroDeString = false;
    } else {
      valor += caractere;
    }
  }
  return valores.filter(Boolean);
}

function extrairObjetosArray(conteudo: string, chave: string): Json[] {
  const inicioCampo = conteudo.indexOf(`"${chave}"`);
  const inicioLista = inicioCampo >= 0 ? conteudo.indexOf("[", inicioCampo) : -1;
  if (inicioLista < 0) return [];
  const objetos: Json[] = [];
  let profundidade = 0;
  let inicioObjeto = -1;
  let dentroDeString = false;
  let escapado = false;
  for (let indice = inicioLista + 1; indice < conteudo.length; indice += 1) {
    const caractere = conteudo[indice]!;
    if (dentroDeString) {
      if (escapado) escapado = false;
      else if (caractere === "\\") escapado = true;
      else if (caractere === '"') dentroDeString = false;
      continue;
    }
    if (caractere === '"') {
      dentroDeString = true;
    } else if (caractere === "{") {
      if (profundidade === 0) inicioObjeto = indice;
      profundidade += 1;
    } else if (caractere === "}") {
      profundidade -= 1;
      if (profundidade === 0 && inicioObjeto >= 0) {
        try {
          objetos.push(objeto(JSON.parse(conteudo.slice(inicioObjeto, indice + 1))));
        } catch {
          // Recupera os objetos completos mesmo quando o último foi truncado.
        }
        inicioObjeto = -1;
      }
    } else if (caractere === "]" && profundidade === 0) {
      break;
    }
  }
  return objetos;
}

function jsonDaResposta(textoResposta: string): Json {
  const limpo = textoResposta
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return objeto(JSON.parse(limpo));
  } catch {
    const inicio = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (inicio >= 0 && fim > inicio) {
      try {
        return objeto(JSON.parse(limpo.slice(inicio, fim + 1)));
      } catch {
        // A saída pode ter sido cortada pelo limite de tokens. Abaixo
        // recuperamos os campos já completos para o chat não exibir JSON.
      }
    }
    const parcial: Json = {};
    const resposta = extrairStringCampo(limpo, "resposta");
    const etapa = extrairStringCampo(limpo, "etapa");
    const consultas = extrairStringsArray(limpo, "consultas");
    const recomendacoes = extrairObjetosArray(limpo, "recomendacoes");
    if (resposta) parcial.resposta = resposta;
    if (etapa) parcial.etapa = etapa;
    if (consultas.length) parcial.consultas = consultas;
    if (recomendacoes.length) parcial.recomendacoes = recomendacoes;
    const categorias = ["passagem", "hospedagem", "visitas", "alimentacao", "transporteLocal", "extras"];
    const orcamento: Json = {};
    categorias.forEach((categoria) => {
      const valor = new RegExp(`"${categoria}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(limpo)?.[1];
      if (valor != null) orcamento[categoria] = Number(valor);
    });
    if (Object.keys(orcamento).length) parcial.orcamentoSugerido = orcamento;
    return parcial;
  }
}

function normalizarRecomendacoes(raw: unknown): MensagemAssistente["recomendacoes"] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item: Json, index) => {
    const value = objeto(item);
    const evidencia = objeto(value.evidencia);
    const categoria = texto(value.categoria) as NonNullable<MensagemAssistente["recomendacoes"]>[number]["categoria"];
    const natureza = texto(value.natureza) as NonNullable<MensagemAssistente["recomendacoes"]>[number]["natureza"];
    return {
      id: texto(value.id) || `recomendacao-${Date.now()}-${index}`,
      tipo: (texto(value.tipo) || "lugar") as NonNullable<MensagemAssistente["recomendacoes"]>[number]["tipo"],
      titulo: texto(value.titulo) || "Sugestão de viagem",
      resumo: texto(value.resumo) || "Confira esta possibilidade antes de adicionar ao roteiro.",
      justificativa: texto(value.justificativa) || "Combina com o contexto informado.",
      evidencia: {
        fonte: texto(evidencia.fonte) || "Consulta do Locus",
        consultadoEm: texto(evidencia.consultadoEm) || new Date().toISOString(),
      },
      ...(texto(value.consulta) ? { consulta: texto(value.consulta) } : {}),
      ...(Number.isFinite(Number(value.avaliacao ?? value.rating ?? value.nota)) ? { avaliacao: Number(value.avaliacao ?? value.rating ?? value.nota) } : {}),
      ...(texto(value.endereco) ? { endereco: texto(value.endereco) } : {}),
      ...(texto(value.categoriaLocal) ? { categoriaLocal: texto(value.categoriaLocal) } : {}),
      ...(Number.isInteger(Number(value.dia)) ? { dia: Number(value.dia) } : {}),
      ...(texto(value.horario) ? { horario: texto(value.horario) } : {}),
      ...(Number.isInteger(Number(value.duracaoMinutos)) ? { duracaoMinutos: Number(value.duracaoMinutos) } : {}),
      ...(Number.isFinite(Number(value.valor)) ? { valor: Number(value.valor) } : {}),
      ...(categoria ? { categoria } : {}),
      ...(natureza ? { natureza } : {}),
    };
  });
}

function normalizarOrcamentoSugerido(raw: unknown): MensagemAssistente["orcamentoSugerido"] {
  const value = objeto(raw);
  const categorias: CategoriaOrcamento[] = [
    "passagem",
    "hospedagem",
    "visitas",
    "alimentacao",
    "transporteLocal",
    "extras",
  ];
  const resultado: Partial<Record<CategoriaOrcamento, number>> = {};
  categorias.forEach((categoria) => {
    const valor = Number(value[categoria]);
    if (Number.isFinite(valor) && valor > 0) resultado[categoria] = Math.round(valor * 100) / 100;
  });
  return Object.keys(resultado).length ? resultado : undefined;
}

function interpretarAssistente(raw: unknown): Pick<MensagemAssistente, "texto" | "recomendacoes" | "orcamentoSugerido" | "consultas" | "etapa"> {
  const respostaDireta = objeto(raw);
  const possuiFormatoDireto = Boolean(
    texto(respostaDireta.resposta)
      || Array.isArray(respostaDireta.consultas)
      || Array.isArray(respostaDireta.recomendacoes),
  );
  const textoResposta = textoGemini(raw);
  const objetoResposta = possuiFormatoDireto ? respostaDireta : jsonDaResposta(textoResposta);
  const consultas = Array.isArray(objetoResposta.consultas)
    ? objetoResposta.consultas.map(texto).filter(Boolean)
    : [];
  const etapa = texto(objetoResposta.etapa) as MensagemAssistente["etapa"];
  const recomendacoes = normalizarRecomendacoes(objetoResposta.recomendacoes);
  const orcamentoSugerido = normalizarOrcamentoSugerido(objetoResposta.orcamentoSugerido);
  const respostaLegivel = texto(objetoResposta.resposta)
    || (!textoResposta.trim().startsWith("{") ? textoResposta.trim() : "");
  return {
    texto: respostaLegivel || "Entendi o pedido. Vou organizar as opções encontradas para você escolher.",
    ...(consultas.length ? { consultas } : {}),
    ...(recomendacoes?.length ? { recomendacoes } : {}),
    ...(orcamentoSugerido ? { orcamentoSugerido } : {}),
    ...(etapa ? { etapa } : {}),
  };
}

type ContextoAssistente = {
  modoOrcamento?: "fixo" | "aberto" | undefined;
  limite?: number | undefined;
  acumulado?: number | undefined;
  orcamentoDetalhado?: string | undefined;
  idade?: number | undefined;
  origem?: string | undefined;
  destino?: string | undefined;
  dataInicio?: string | undefined;
  dataFim?: string | undefined;
  transporte?: string | undefined;
  prioridadeTransporte?: string | undefined;
  veiculo?: string | undefined;
  interesses?: string[] | undefined;
  ritmo?: string | undefined;
  hospedagem?: string | undefined;
  hospedagemBase?: string | undefined;
  roteiro?: string | undefined;
};

export function respostaLocalAssistente(textoPergunta: string, contexto?: ContextoAssistente): MensagemAssistente {
  const destino = contexto?.destino?.trim();
  const pergunta = textoPergunta.toLowerCase();
  const querHospedagem = /hotel|hospedagem|pousada|hostel|onde ficar/.test(pergunta);
  const querPassagem = /passagem|passagens|voo|voos|avião|aviao/.test(pergunta);
  const consultas = destino
    ? [
        querHospedagem
          ? `hotéis e hospedagens reais em ${destino}`
          : querPassagem
            ? `pontos de apoio e aeroporto em ${destino}`
            : `pontos turísticos, praias e atrações em ${destino}`,
        ...(contexto?.interesses?.length ? [`${contexto.interesses.join(", ")} em ${destino}`] : []),
      ]
    : [];
  const limite = contexto?.limite == null
    ? "Orçamento aberto: vou somar cada escolha."
    : `Saldo disponível aproximado: R$ ${Math.max(0, contexto.limite - (contexto.acumulado ?? 0)).toFixed(2)}.`;
  const valores = contexto?.orcamentoDetalhado ? ` ${contexto.orcamentoDetalhado}` : "";
  const querOrcamento = /orçamento|orcamento|quanto.*gasto|quanto.*levar|valor.*viagem|gastos?|custos?|preço total|preco total|definir valores|limites?|categorias?.*(visitas|alimentação|transporte|extras)/.test(pergunta);
  const orcamentoSugerido = querOrcamento && destino
    ? {
        passagem: contexto?.transporte === "onibus" ? 900 : contexto?.transporte === "carro" || contexto?.transporte === "moto" ? 650 : 2200,
        hospedagem: 2800,
        visitas: 600,
        alimentacao: 1200,
        transporteLocal: 450,
        extras: 350,
      }
    : undefined;
  return {
    id: uid(),
    autor: "assistente",
    texto: destino
      ? `Entendi. Vou buscar opções reais em ${destino}, organizar por proximidade e separar as sugestões por dia. ${limite}${valores} Confira os resultados e o Street View antes de adicionar.`
      : "Para montar recomendações reais, preciso saber qual é o destino da viagem. Informe a cidade e o país no chat ou crie uma viagem primeiro.",
    ...(consultas.length ? { consultas } : {}),
    ...(orcamentoSugerido ? { orcamentoSugerido } : {}),
    etapa: querPassagem ? "passagem" : querHospedagem ? "hospedagem" : "roteiro",
    criadaEm: new Date().toISOString(),
  };
}

// ---------- Assistente Locus (Gemini com fallback Groq no backend) ----------
export async function perguntarGemini(
  historico: MensagemAssistente[],
  textoPergunta: string,
  contexto?: ContextoAssistente,
): Promise<MensagemAssistente> {
  const historicoTexto = historico
    .slice(-8)
    .map((item) => `${item.autor === "usuario" ? "Usuário" : "Assistente"}: ${item.texto}`)
    .join("\n");
  const financeiro = contexto
    ? `Contexto financeiro: orçamento ${contexto.modoOrcamento === "fixo" ? "FIXO" : "ABERTO"}; `
      + `valor já acumulado R$ ${(contexto.acumulado ?? 0).toFixed(2)}; `
      + (contexto.limite == null
        ? "sem limite máximo."
        : `limite total R$ ${contexto.limite.toFixed(2)} e saldo restante R$ ${Math.max(0, contexto.limite - (contexto.acumulado ?? 0)).toFixed(2)}.`)
    : "";
  const viagem = contexto
    ? [
        contexto.origem ? `Origem: ${contexto.origem}.` : "",
        contexto.destino ? `Destino obrigatório desta viagem: ${contexto.destino}.` : "",
        contexto.dataInicio && contexto.dataFim ? `Datas: ${contexto.dataInicio} até ${contexto.dataFim}.` : "",
        contexto.idade ? `Idade do viajante principal: ${contexto.idade}.` : "",
        contexto.transporte ? `Transporte escolhido: ${contexto.transporte}.` : "",
        contexto.prioridadeTransporte ? `Prioridade do transporte: ${contexto.prioridadeTransporte}.` : "",
        contexto.veiculo ? `Veículo disponível: ${contexto.veiculo}.` : "",
        contexto.interesses?.length ? `Interesses: ${contexto.interesses.join(", ")}.` : "",
        contexto.ritmo ? `Ritmo: ${contexto.ritmo}.` : "",
        contexto.hospedagem ? `Hospedagem preferida: ${contexto.hospedagem}.` : "",
        contexto.hospedagemBase ? `Base de proximidade obrigatória: ${contexto.hospedagemBase}. Recomende locais turísticos próximos dessa hospedagem.` : "",
        contexto.roteiro ? `Itens já adicionados ao roteiro: ${contexto.roteiro}.` : "",
        contexto.orcamentoDetalhado ? `Resumo por categoria: ${contexto.orcamentoDetalhado}. Ajude a pessoa a definir e revisar os valores de passagem, hospedagem, visitas, alimentação, transporte local e extras.` : "",
      ].filter(Boolean).join(" ")
    : "";
  const regras = "Não repita saudações nem perguntas já respondidas. Recomende somente locais dentro do destino obrigatório; para locais nomeados, gere consultas ao Google Places e deixe a confirmação dos dados para a busca real. Quando houver hospedagem-base, priorize locais em até 20 km dela e informe que o sistema vai conferir a distância e a rota. Quando a pessoa perguntar sobre orçamento, mostre o total, o acumulado e uma sugestão separada por categoria. Nunca ultrapasse o limite fixo; em orçamento aberto, some cada escolha e explique o valor estimado que ainda falta para alimentação, transporte local e extras.";
  const promptCompleto = [financeiro, viagem, regras, historicoTexto, `Usuário: ${textoPergunta}`]
    .filter(Boolean)
    .join("\n\n");
  const prompt = promptCompleto.length > 11500
    ? promptCompleto.slice(promptCompleto.length - 11500)
    : promptCompleto;
  try {
    const raw = await chamar(() =>
      api.post<Json>(`${BASE}/gemini/conteudo`, { prompt }, { timeout: 30000 }),
    );
    const interpretada = interpretarAssistente(raw);
    if (interpretada.texto !== "Recebi uma resposta vazia. Tente reformular a pergunta." || interpretada.consultas?.length || interpretada.orcamentoSugerido) {
      return {
        id: uid(),
        autor: "assistente",
        ...interpretada,
        criadaEm: new Date().toISOString(),
      };
    }
  } catch {
    // O planejador local mantém o chat útil enquanto o provedor de IA se recupera.
  }
  return respostaLocalAssistente(textoPergunta, contexto);
}

// ---------- Google Places ----------
export interface ResultadoBusca {
  lugares: Lugar[];
  fallback: boolean;
}

// O Places tem limite de taxa. Uma busca feita pelo chat, pela lateral e pelo
// autocomplete não deve disparar três chamadas idênticas a cada renderização.
// O cache curto também permite que o chat continue funcionando com fallback
// local enquanto a cota do Google é recomposta.
const CACHE_PLACES_MS = 45_000;
const cacheBusca = new Map<string, { expiraEm: number; resultado: ResultadoBusca }>();
const cacheAutocomplete = new Map<string, { expiraEm: number; resultado: { id: string; texto: string }[] }>();
let placesIndisponivelAte = 0;

function chaveBusca(valor: string): string {
  return valor.trim().toLocaleLowerCase();
}

function placesFoiLimitado(error: unknown): boolean {
  return error instanceof LocusError && error.tipo === "quota";
}

export async function buscaTextual(q: string): Promise<ResultadoBusca> {
  const chave = chaveBusca(q);
  const cacheado = cacheBusca.get(chave);
  if (cacheado && cacheado.expiraEm > Date.now()) return cacheado.resultado;
  if (placesIndisponivelAte > Date.now()) {
    const resultado = { lugares: lugaresDemonstrativos(q), fallback: true };
    cacheBusca.set(chave, { expiraEm: Date.now() + CACHE_PLACES_MS, resultado });
    return resultado;
  }
  try {
    const raw = await chamar<Json>(() =>
      api.post(`${BASE}/google/places/busca-textual`, { textQuery: q, languageCode: "pt-BR" }),
    );
    const places = Array.isArray(raw.places) ? raw.places : [];
    const resultado = places.length
      ? { lugares: places.map(normalizarLugar), fallback: false }
      : { lugares: lugaresDemonstrativos(q), fallback: true };
    cacheBusca.set(chave, { expiraEm: Date.now() + CACHE_PLACES_MS, resultado });
    return resultado;
  } catch (error) {
    if (placesFoiLimitado(error) || error instanceof LocusError) {
      placesIndisponivelAte = Date.now() + CACHE_PLACES_MS;
      const resultado = { lugares: lugaresDemonstrativos(q), fallback: true };
      cacheBusca.set(chave, { expiraEm: Date.now() + CACHE_PLACES_MS, resultado });
      return resultado;
    }
    throw error;
  }
}

export async function autocomplete(q: string): Promise<{ id: string; texto: string }[]> {
  if (q.length < 2) return [];
  const chave = chaveBusca(q);
  const cacheado = cacheAutocomplete.get(chave);
  if (cacheado && cacheado.expiraEm > Date.now()) return cacheado.resultado;
  if (placesIndisponivelAte > Date.now()) {
    const resultado = sugestoesLocaisFallback(q);
    cacheAutocomplete.set(chave, { expiraEm: Date.now() + CACHE_PLACES_MS, resultado });
    return resultado;
  }
  try {
    const raw = await chamar<Json>(() =>
      api.post(`${BASE}/google/places/autocomplete`, { input: q }),
    );
    const suggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
    const resultadoGoogle = suggestions
    .map((item: Json) => {
      const prediction = objeto(objeto(item).placePrediction);
      const description = objeto(prediction.text);
      return {
        id: texto(prediction.placeId),
        texto: texto(description.text) || texto(prediction.placeId),
      };
    })
    .filter((item: { id: string; texto: string }) => item.id || item.texto);
    const resultado = resultadoGoogle.length ? resultadoGoogle : sugestoesLocaisFallback(q);
    cacheAutocomplete.set(chave, { expiraEm: Date.now() + CACHE_PLACES_MS, resultado });
    return resultado;
  } catch (error) {
    if (placesFoiLimitado(error) || error instanceof LocusError) {
      placesIndisponivelAte = Date.now() + CACHE_PLACES_MS;
      const resultado = sugestoesLocaisFallback(q);
      cacheAutocomplete.set(chave, { expiraEm: Date.now() + CACHE_PLACES_MS, resultado });
      return resultado;
    }
    throw error;
  }
}

export async function detalhesLugar(placeId: string): Promise<Lugar> {
  return normalizarLugar(
    await chamar<Json>(() => api.get(`${BASE}/google/places/${encodeURIComponent(placeId)}`)),
  );
}

// ---------- Google Routes ----------
export interface Trecho {
  de: string;
  para: string;
  minutos: number;
  km: number;
}

export async function calcularRota(
  pontos: { lat: number; lng: number; nome: string }[],
): Promise<Trecho[]> {
  if (pontos.length < 2) return [];
  const toWaypoint = (point: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: point.lat, longitude: point.lng } },
  });
  const raw = await chamar<Json>(() =>
    api.post(`${BASE}/google/routes`, {
      origin: toWaypoint(pontos[0]!),
      destination: toWaypoint(pontos[pontos.length - 1]!),
      intermediates: pontos.slice(1, -1).map(toWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
      languageCode: "pt-BR",
      units: "METRIC",
    }),
  );
  const routes = Array.isArray(raw.routes) ? raw.routes : [];
  const legs = Array.isArray(objeto(routes[0]).legs) ? objeto(routes[0]).legs : [];
  return legs.map((leg: Json, index: number) => {
    const item = objeto(leg);
    const duration = texto(item.duration).replace(/s$/, "");
    return {
      de: pontos[index]?.nome ?? "Origem",
      para: pontos[index + 1]?.nome ?? "Destino",
      minutos: Math.ceil(numero(duration) / 60),
      km: numero(item.distanceMeters) / 1000,
    };
  });
}

// ---------- Street View ----------
export interface StreetViewMeta {
  status: string;
  imagemUrl?: string;
  embedUrl?: string;
  mapaUrl?: string;
  data?: string;
}

export async function streetViewMetadata(lat: number, lng: number, radius = 150): Promise<StreetViewMeta> {
  const resultado = await chamar<StreetViewMeta>(() =>
    api.get<StreetViewMeta>(`${BASE}/google/street-view/metadata`, {
      params: { location: `${lat},${lng}`, radius },
    }),
  );
  let imagemUrl: string | undefined;
  if (resultado.status === "OK") {
    try {
      const imagem = await api.get<Blob>(`${BASE}/google/street-view/image`, {
        params: { location: `${lat},${lng}`, width: 900, height: 520 },
        responseType: "blob",
      });
      imagemUrl = URL.createObjectURL(imagem.data);
    } catch {
      // A imagem é opcional: o mapa panorâmico continua disponível mesmo
      // quando a chave do Street View ainda não foi habilitada no backend.
    }
  }
  return {
    ...resultado,
    ...(imagemUrl ? { imagemUrl } : {}),
    mapaUrl: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`,
  };
}

// ---------- Catálogo de ofertas do Locus ----------
function normalizarVoo(raw: unknown, passageirosPadrao = 1): OfertaVoo {
  const value = objeto(raw);
  const price = objeto(value.price);
  const itineraries = Array.isArray(value.itineraries) ? value.itineraries : [];
  const firstItinerary = objeto(itineraries[0]);
  const segments = Array.isArray(firstItinerary.segments) ? firstItinerary.segments : [];
  const first = objeto(segments[0]);
  const last = objeto(segments[segments.length - 1]);
  const returnItinerary = objeto(itineraries[1]);
  const returnSegments = Array.isArray(returnItinerary.segments) ? returnItinerary.segments : [];
  const returnDeparture = objeto(objeto(returnSegments[0]).departure);
  const departure = objeto(first.departure);
  const arrival = objeto(last.arrival);
  return {
    id: texto(value.id),
    companhia:
      (Array.isArray(value.validatingAirlineCodes) ? texto(value.validatingAirlineCodes[0]) : "") ||
      "Companhia aérea",
    origem: texto(departure.iataCode),
    destino: texto(arrival.iataCode),
    ida: texto(departure.at),
    volta: texto(returnDeparture.at),
    passageiros: Math.max(1, numero(value.travelerCount) || passageirosPadrao),
    ...(value.roundTrip === true ? { idaEVolta: true } : {}),
    classe: "Econômica",
    bagagem: "Consultar oferta",
    moeda: texto(price.currency) || "BRL",
    taxas: numero(price.total) - numero(price.base),
    preco: numero(price.total),
    fonte: value.simulated === true ? "Locus" : "Provedor configurado",
    consultadoEm: new Date().toISOString(),
    historico: [],
  };
}

export async function buscarVoos(params: Record<string, string | number>): Promise<OfertaVoo[]> {
  const raw = await chamar<Json>(() => api.get(`${BASE}/ofertas/voos`, { params }));
  const passageiros = Math.max(1, Number(params["adults"] ?? 1));
  return (Array.isArray(raw.data) ? raw.data : []).map((item) => normalizarVoo(item, passageiros));
}

export async function buscarLocalizacoes(keyword: string): Promise<{ iataCode: string; nome: string }[]> {
  const raw = await chamar<Json>(() => api.get(`${BASE}/ofertas/localizacoes`, { params: { keyword } }));
  return (Array.isArray(raw.data) ? raw.data : [])
    .map((item: Json) => {
      const address = objeto(item.address);
      return {
        iataCode: texto(item.iataCode).toUpperCase(),
        nome: texto(address.cityName) || texto(item.name?.cityName) || texto(item.name),
      };
    })
    .filter((item: { iataCode: string; nome: string }) => /^[A-Z]{3}$/.test(item.iataCode));
}

export async function precificarVoo(oferta: OfertaVoo | Json): Promise<Json> {
  return chamar(() => api.post<Json>(`${BASE}/ofertas/voos/preco`, oferta));
}

export async function buscarHoteis(
  params: Record<string, string | number>,
): Promise<OfertaHotel[]> {
  const cidade = texto(params["cityName"]) || texto(params["cityCode"]);
  const entrada = texto(params["checkInDate"]);
  const saida = texto(params["checkOutDate"]);
  const adultos = Math.max(1, numero(params["adults"], 1));
  const quartos = Math.max(1, numero(params["roomQuantity"], 1));
  const noites = entrada && saida
    ? Math.max(1, Math.floor((new Date(`${saida}T12:00:00`).getTime() - new Date(`${entrada}T12:00:00`).getTime()) / 86400000))
    : 0;
  try {
    const raw = await chamar<Json>(() =>
      api.post(`${BASE}/google/places/busca-textual`, {
        textQuery: `hotéis e hospedagens reais em ${cidade}`,
        languageCode: "pt-BR",
      }),
    );
    const places = Array.isArray(raw.places) ? raw.places : [];
    if (!places.length) return hospedagensExemplo(params);
    return Promise.all(places.slice(0, 8).map(async (place: Json, index: number) => {
    const value = objeto(place);
    const displayName = objeto(value.displayName);
    const location = objeto(value.location);
    const photos = Array.isArray(value.photos) ? value.photos : [];
    const photoName = texto(objeto(photos[0]).name);
    let imagemUrl: string | undefined;
    if (photoName) {
      try {
        const imagem = await api.get<Blob>(`${BASE}/google/places/photo`, {
          params: { name: photoName, maxWidthPx: 900 },
          responseType: "blob",
        });
        imagemUrl = URL.createObjectURL(imagem.data);
      } catch {
        // A foto é opcional; o hotel real continua aparecendo com nome e endereço.
      }
    }
    return {
      id: texto(value.id) || `hotel-${index}`,
      hotel: texto(displayName.text) || "Hospedagem encontrada no Google",
      quarto: `${adultos} hóspede(s) · ${quartos} quarto(s)`,
      hospedes: adultos,
      quartos,
      ...(noites > 0 ? { noites } : {}),
      checkin: entrada,
      checkout: saida,
      regime: "Consultar oferta",
      politica: "Consultar oferta",
      moeda: "BRL",
      taxas: 0,
      // O Places confirma o estabelecimento, mas não fornece tarifa para as datas.
      // Não inventamos preço: a tela mostra “Consultar”.
      preco: 0,
      ...(imagemUrl ? { imagemUrl } : {}),
      latitude: numero(location.latitude),
      longitude: numero(location.longitude),
      endereco: texto(value.formattedAddress) || texto(value.shortFormattedAddress),
      fonte: "Google Places",
      consultadoEm: new Date().toISOString(),
      historico: [],
    } satisfies OfertaHotel;
    }));
  } catch {
    // A consulta de tarifas não pode impedir o usuário de continuar o
    // planejamento. Os exemplos abaixo são claramente identificados e
    // calculados para o destino, datas, hóspedes e quartos informados.
    return hospedagensExemplo(params);
  }
}
