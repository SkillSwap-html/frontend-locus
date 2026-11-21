import type { CategoriaOrcamento, Lugar, MensagemAssistente, OfertaHotel, OfertaVoo } from "@/types";
import { api, chamar } from "./api";
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
        return {};
      }
    }
    return {};
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
      ...(texto(value.placeId) ? { placeId: texto(value.placeId) } : {}),
      ...(Number.isFinite(Number(value.avaliacao)) ? { avaliacao: Number(value.avaliacao) } : {}),
      ...(texto(value.endereco) ? { endereco: texto(value.endereco) } : {}),
      ...(Number.isFinite(Number(value.lat)) ? { lat: Number(value.lat) } : {}),
      ...(Number.isFinite(Number(value.lng)) ? { lng: Number(value.lng) } : {}),
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
  const textoResposta = textoGemini(raw);
  const objetoResposta = jsonDaResposta(textoResposta);
  const consultas = Array.isArray(objetoResposta.consultas)
    ? objetoResposta.consultas.map(texto).filter(Boolean)
    : [];
  const etapa = texto(objetoResposta.etapa) as MensagemAssistente["etapa"];
  const recomendacoes = normalizarRecomendacoes(objetoResposta.recomendacoes);
  const orcamentoSugerido = normalizarOrcamentoSugerido(objetoResposta.orcamentoSugerido);
  return {
    texto: texto(objetoResposta.resposta) || textoResposta || "Recebi uma resposta vazia. Tente reformular a pergunta.",
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
  const querOrcamento = /orçamento|orcamento|quanto.*gasto|quanto.*levar|valor.*viagem|gastos?|custos?|preço total|preco total/.test(pergunta);
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

export async function buscaTextual(q: string): Promise<ResultadoBusca> {
  const raw = await chamar<Json>(() =>
    api.post(`${BASE}/google/places/busca-textual`, { textQuery: q, languageCode: "pt-BR" }),
  );
  const places = Array.isArray(raw.places) ? raw.places : [];
  return { lugares: places.map(normalizarLugar), fallback: false };
}

export async function autocomplete(q: string): Promise<{ id: string; texto: string }[]> {
  if (q.length < 2) return [];
  const raw = await chamar<Json>(() =>
    api.post(`${BASE}/google/places/autocomplete`, { input: q }),
  );
  const suggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  return suggestions
    .map((item: Json) => {
      const prediction = objeto(objeto(item).placePrediction);
      const description = objeto(prediction.text);
      return {
        id: texto(prediction.placeId),
        texto: texto(description.text) || texto(prediction.placeId),
      };
    })
    .filter((item: { id: string; texto: string }) => item.id || item.texto);
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

export async function streetViewMetadata(lat: number, lng: number): Promise<StreetViewMeta> {
  const resultado = await chamar<StreetViewMeta>(() =>
    api.get<StreetViewMeta>(`${BASE}/google/street-view/metadata`, {
      params: { location: `${lat},${lng}` },
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
  const raw = await chamar<Json>(() =>
    api.post(`${BASE}/google/places/busca-textual`, {
      textQuery: `hotéis e hospedagens reais em ${cidade}`,
      languageCode: "pt-BR",
    }),
  );
  const places = Array.isArray(raw.places) ? raw.places : [];
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
}
