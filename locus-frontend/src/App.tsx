import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CheckCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Compass,
  Download,
  Eye,
  FileText,
  Globe2,
  Heart,
  Home,
  LogOut,
  Map,
  MapPin,
  Menu,
  Navigation,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Share2,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";

import { api, normalizarErro } from "@/services/api";
import { entrarComGoogle, sair, usuarioAtual } from "@/services/auth";
import {
  autocomplete,
  buscaTextual,
  calcularRota,
  parecePlaceIdGoogle,
  perguntarGemini,
  respostaLocalAssistente,
  type StreetViewMeta,
  type Trecho,
} from "@/services/integracoes";
import { lerPreferenciasBackend } from "@/services/preferencias";
import { cancelarSimulacao, confirmarRoteiro, listarReservas } from "@/services/reservas";
import { baixarRelatorio, listarRelatorios } from "@/services/relatorios";
import { adicionarRecomendacao, compararVersoes, criarLinkCompartilhamento, criarRoteiroInicial, criarVersao, editarItemRoteiro, excluirItemOrcamento, excluirItemRoteiro, restaurarVersao } from "@/services/roteiros";
import { limparUsuarioBackend, sincronizarUsuario } from "@/services/usuarioBackend";
import { criarViagem, definirLimitesOrcamento, listarNotificacoes, listarViagens, marcarLida, marcarTodasComoLidas, obterViagem } from "@/services/viagens";
import { MapPreview } from "@/components/MapPreview";
import { GoogleEmbedMap } from "@/components/GoogleEmbedMap";
import { GoogleStreetView } from "@/components/GoogleStreetView";
import { AdminView } from "@/components/AdminView";
import { PlanningFlow } from "@/components/PlanningFlow";
import { PreferencesView } from "@/components/PreferencesView";
import { brl, CATEGORIAS, resumirOrcamento } from "@/features/budget/logic";
import type {
  CategoriaOrcamento,
  ItemOrcamento,
  ItemRoteiro,
  Lugar,
  MensagemAssistente,
  ModoOrcamento,
  Moeda,
  Preferencias,
  Recomendacao,
  Relatorio,
  Notificacao,
  Transporte,
  Usuario,
  Viagem,
} from "@/types";

type View = "inicio" | "viagem" | "nova" | "ia" | "perfil" | "preferencias" | "admin";
const LIMITES: Record<CategoriaOrcamento, number> = {
  passagem: 0,
  hospedagem: 0,
  visitas: 0,
  alimentacao: 0,
  transporteLocal: 0,
  extras: 0,
};
const menu = [
  { id: "inicio" as View, label: "Visão geral", icon: Home },
  { id: "viagem" as View, label: "Minhas viagens", icon: Map },
  { id: "ia" as View, label: "Assistente Locus", icon: Sparkles },
  { id: "perfil" as View, label: "Meu perfil", icon: CircleUserRound },
];
const dataPadrao = {
  titulo: "Minha próxima viagem",
  origem: "Salvador, BA",
  destino: "",
  dataInicio: "",
  dataFim: "",
  transporte: "aviao" as Transporte,
  modoOrcamento: "aberto" as ModoOrcamento,
  limiteTotal: "",
  mochilao: false,
};
const HORARIOS_ROTEIRO = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
const TAXAS_CAMBIO_REFERENCIA: Record<Moeda, number> = {
  BRL: 1,
  USD: Number(import.meta.env["VITE_USD_BRL_RATE"]) || 5.75,
  EUR: Number(import.meta.env["VITE_EUR_BRL_RATE"]) || 6.20,
};

function campo<T = unknown>(obj: unknown, chave: string): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[chave] as T | undefined;
}
function tituloViagem(viagem: Viagem): string {
  return viagem.titulo || `Roteiro para ${viagem.destino || "seu próximo destino"}`;
}
function nomeArquivoRoteiro(viagem: Viagem): string {
  const slug = tituloViagem(viagem)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "locus";
  return `roteiro-${slug}.pdf`;
}
function transporteViagem(viagem: Viagem): string {
  return viagem.transporte || String(campo(viagem, "modoTransporte") ?? "aviao").toLowerCase();
}
function dataBr(data?: string): string {
  if (!data) return "Data a definir";
  const [ano, mes, dia] = data.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : data;
}
function totalViagem(viagem: Viagem): number {
  const itensOrcamento = (viagem.orcamento ?? []).reduce((total, item) => total + Number(item.valor || 0), 0);
  const itensRoteiro = (viagem.roteiro ?? []).reduce((total, item) => total + Number(item.valorEstimado || 0), 0);
  return itensOrcamento + itensRoteiro;
}
function itensParaResumo(viagem: Viagem): ItemOrcamento[] {
  const roteiro = (viagem.roteiro ?? [])
    .filter((item) => Number(item.valorEstimado || 0) > 0)
    .map((item) => ({
      id: `roteiro-${item.id}`,
      categoria: "visitas" as CategoriaOrcamento,
      descricao: item.titulo,
      valor: Number(item.valorEstimado || 0),
      natureza: "simulado" as ItemOrcamento["natureza"],
    }));
  return [...(viagem.orcamento ?? []), ...roteiro];
}
function distanciaKm(a: Pick<Lugar, "lat" | "lng">, b: Pick<Lugar, "lat" | "lng">): number {
  const raio = 6371;
  const latitude = ((b.lat - a.lat) * Math.PI) / 180;
  const longitude = ((b.lng - a.lng) * Math.PI) / 180;
  const origem = (a.lat * Math.PI) / 180;
  const destino = (b.lat * Math.PI) / 180;
  const seno = Math.sin(latitude / 2) ** 2 + Math.cos(origem) * Math.cos(destino) * Math.sin(longitude / 2) ** 2;
  return raio * 2 * Math.atan2(Math.sqrt(seno), Math.sqrt(1 - seno));
}
function ordenarLugares(lugares: Lugar[], referencia?: Pick<Lugar, "lat" | "lng">): Lugar[] {
  if (lugares.length < 2) return lugares;
  const primeiro = referencia
    ? [...lugares].sort((a, b) => distanciaKm(referencia, a) - distanciaKm(referencia, b))[0]!
    : lugares[0]!;
  const resultado: Lugar[] = [{
    ...primeiro,
    ...(referencia ? { distanciaKm: distanciaKm(referencia, primeiro) } : {}),
  }];
  const restantes = lugares.filter((item) => item.placeId !== primeiro.placeId);
  while (restantes.length) {
    const ultimo = resultado[resultado.length - 1]!;
    let indice = 0;
    let menor = Number.POSITIVE_INFINITY;
    restantes.forEach((item, atual) => {
      const distancia = distanciaKm(ultimo, item);
      if (distancia < menor) {
        menor = distancia;
        indice = atual;
      }
    });
    const [proximo] = restantes.splice(indice, 1);
    if (proximo) resultado.push({ ...proximo, distanciaKm: menor });
  }
  return resultado;
}
function lugarEhHospedagem(lugar: Lugar): boolean {
  const textoLugar = [lugar.nome, lugar.categoria, ...(lugar.tipos ?? [])].join(" ").toLowerCase();
  return /hotel|hospedagem|pousada|hostel|resort|alojamento|lodging/.test(textoLugar);
}
function moedaDoDestino(destino: string): Moeda {
  const textoDestino = destino.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/brasil|brazil|salvador|sao paulo|rio de janeiro|recife|fortaleza|curitiba|florianopolis/.test(textoDestino)) return "BRL";
  if (/franca|france|paris|italia|italy|roma|rome|espanha|spain|madrid|barcelona|portugal|lisboa|germany|alemanha|berlin|grecia|greece|amsterdam|paises baixos|holanda|viena|austria|irlanda|ireland|belgica|belgium|suica|switzerland|noruega|norway|suecia|sweden|dinamarca|denmark|finlandia|finland/.test(textoDestino)) return "EUR";
  return "USD";
}
function formatarMoeda(valor: number, moeda: Moeda): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);
}
type CustosEstimados = NonNullable<Recomendacao["custos"]>;
function estimativasDoLocal(lugar: Lugar, destino: string): { custos: CustosEstimados; totalBrl: number } {
  const textoLugar = [lugar.nome, lugar.categoria, ...(lugar.tipos ?? [])].join(" ").toLowerCase();
  const moeda = moedaDoDestino(`${destino} ${lugar.endereco ?? ""}`);
  const valores = moeda === "BRL"
    ? { visitas: 45, alimentacao: 60, transporteLocal: 35, extras: 20 }
    : { visitas: 15, alimentacao: 20, transporteLocal: 7, extras: 5 };
  if (/restaurant|restaurante|cafe|cafe|bar|comida|gastronomia/.test(textoLugar)) {
    valores.visitas = 0;
    valores.alimentacao = moeda === "BRL" ? 90 : 24;
  } else if (/beach|praia|park|parque|natural|praca|praça/.test(textoLugar)) {
    valores.visitas = 0;
    valores.alimentacao = moeda === "BRL" ? 55 : 16;
  } else if (/museum|museu|tourist|turist|historical|histor|aquarium|aquario/.test(textoLugar)) {
    valores.visitas = moeda === "BRL" ? 45 : 18;
  }
  const taxa = TAXAS_CAMBIO_REFERENCIA[moeda];
  const custos = (Object.entries(valores) as [CategoriaOrcamento, number][]).reduce<CustosEstimados>((resultado, [categoria, valor]) => {
    resultado[categoria] = {
      valor,
      valorBrl: Math.round(valor * taxa * 100) / 100,
      moeda,
    };
    return resultado;
  }, {});
  return {
    custos,
    totalBrl: Object.values(custos).reduce((total, custo) => total + Number(custo?.valorBrl ?? 0), 0),
  };
}
function estimativaLocal(lugar: Lugar): { categoria: CategoriaOrcamento; valor: number; rotulo: string } {
  const textoLugar = [lugar.nome, lugar.categoria, ...(lugar.tipos ?? [])].join(" ").toLowerCase();
  if (/restaurant|restaurante|cafe|café|bar|comida|gastronomia/.test(textoLugar)) {
    return { categoria: "alimentacao", valor: 90, rotulo: "estimativa de alimentação por pessoa" };
  }
  if (/museum|museu|tourist|turíst|historical|histór|aquarium|aquário/.test(textoLugar)) {
    return { categoria: "visitas", valor: 45, rotulo: "estimativa de ingresso" };
  }
  if (/beach|praia|park|parque|natural|praça|praca/.test(textoLugar)) {
    return { categoria: "visitas", valor: 0, rotulo: "gratuito ou preço não informado" };
  }
  return { categoria: "visitas", valor: 30, rotulo: "estimativa de visita" };
}

function separarDestinosInformados(valor: string): string[] {
  const texto = valor.trim();
  if (!texto) return [];
  const partes = texto
    .split(/\s*(?:;|\||\/|\r?\n)\s*/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
  return [...new Set((partes.length ? partes : [texto]).map((item) => item.trim()))];
}

function consultasParaLocais(pergunta: string, destino: string): string[] {
  if (!destino) return [];
  const normalizada = pergunta.toLowerCase();
  const pedeHospedagem = /hotel|hospedagem|pousada|hostel|resort|onde ficar/.test(normalizada);
  const pedePassagem = /passagem|passagens|voo|voos|avião|aviao|aeroporto/.test(normalizada);
  const pedePraia = /praia|praias|mar|litoral|beach/.test(normalizada);
  const pedeRestaurante = /restaurante|restaurantes|comida|gastronomia|jantar|almoço|almoco|café|cafe/.test(normalizada);
  const pedeAtracao = /ponto|turíst|turist|museu|parque|atraç|visitar|roteiro|lugar|lugares|passeio/.test(normalizada);
  if (pedePassagem && !pedeHospedagem && !pedeAtracao && !pedePraia && !pedeRestaurante) return [];
  const destinos = separarDestinosInformados(destino);
  const consultas: string[] = [];
  for (const local of destinos) {
    if (pedeHospedagem) consultas.push(`hotéis, pousadas e hospedagens reais em ${local}`);
    if (pedePraia) consultas.push(`praias reais e lugares para banho em ${local}`);
    if (pedeRestaurante) consultas.push(`restaurantes e gastronomia local em ${local}`);
    if (pedeAtracao || (!pedeHospedagem && !pedePraia && !pedeRestaurante)) {
      consultas.push(`pontos turísticos, museus, parques e atrações reais em ${local}`);
    }
    // Para cada cidade, país ou estado informado, consulta também categorias
    // complementares. Assim uma viagem com múltiplos destinos não fica presa
    // ao primeiro local da string.
    if (!pedeHospedagem && (pedeAtracao || pedePraia || pedeRestaurante)) {
      if (!pedePraia) consultas.push(`praias e atrações naturais em ${local}`);
      if (!pedeRestaurante) consultas.push(`restaurantes e gastronomia local em ${local}`);
    }
  }
  const limite = Math.max(8, destinos.length * 3);
  return [...new Set(consultas)].slice(0, limite);
}
function formatarTransporte(value: string): string {
  return (
    (
      {
        aviao: "Avião",
        onibus: "Ônibus",
        carro: "Carro",
        moto: "Moto",
        particular: "Veículo particular",
      } as Record<string, string>
    )[value] ?? value
  );
}
function rotuloCategoria(value: CategoriaOrcamento): string {
  return CATEGORIAS.find((item) => item.id === value)?.rotulo ?? value;
}
function estrelasAvaliacao(avaliacao?: number): string {
  if (avaliacao == null || !Number.isFinite(avaliacao)) return "";
  const preenchidas = Math.max(0, Math.min(5, Math.round(avaliacao)));
  return `${"★".repeat(preenchidas)}${"☆".repeat(5 - preenchidas)} ${avaliacao.toFixed(1)}`;
}

function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [selecionada, setSelecionada] = useState<Viagem | null>(null);
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [view, setView] = useState<View>("inicio");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false);
  const [diaAssistente, setDiaAssistente] = useState<number | undefined>(undefined);

  useEffect(() => {
    void usuarioAtual()
      .then(setUsuario)
      .catch((error) => setToast(normalizarErro(error).message));
  }, []);
  useEffect(() => {
    if (!usuario) return;
    void (async () => {
      try {
        const sincronizado = await sincronizarUsuario(usuario);
        if (sincronizado.tipoUsuario === "ADMINISTRADOR") {
          setUsuario((atual) => (atual ? { ...atual, papel: "admin" } : atual));
        }
      } catch (error) {
        limparUsuarioBackend();
        setToast(normalizarErro(error).message);
        return;
      }
      try {
        const [lista, notificacoesAtuais] = await Promise.all([
          listarViagens(),
          listarNotificacoes().catch(() => []),
        ]);
        setViagens(lista);
        setNotificacoes(notificacoesAtuais);
        if (lista.length > 0) setSelecionada((atual) => atual ?? lista[0]!);
        const porViagem = await Promise.all(
          lista.map((item) => listarRelatorios(item.id).catch(() => [])),
        );
        setRelatorios(porViagem.flat());
      } catch (error) {
        setViagens([]);
        setToast(normalizarErro(error).message);
      }
    })();
  }, [usuario]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function autenticarGoogle() {
    setCarregando(true);
    try {
      const sessao = await entrarComGoogle();
      if (sessao) {
        setUsuario(sessao);
        setToast("Login com Google concluído.");
      }
    } catch (error) {
      setToast(normalizarErro(error).message);
    } finally {
      setCarregando(false);
    }
  }
  async function handleSair() {
    await sair();
    limparUsuarioBackend();
    setUsuario(null);
    setViagens([]);
    setSelecionada(null);
    setRelatorios([]);
    setNotificacoes([]);
    setNotificacoesAbertas(false);
    setView("inicio");
  }
  async function abrirViagem(viagem: Viagem) {
    setCarregando(true);
    try {
      setSelecionada(await obterViagem(viagem.id));
    } catch {
      setSelecionada(viagem);
    } finally {
      setCarregando(false);
      setView("viagem");
      setMobileMenu(false);
    }
  }
  async function confirmar(viagem: Viagem) {
    setCarregando(true);
    try {
      const resultado = await confirmarRoteiro(viagem.id, totalViagem(viagem));
      setRelatorios((atuais) => [
        resultado.relatorio,
        ...atuais.filter((item) => item.id !== resultado.relatorio.id),
      ]);
      setToast(
        `Simulação confirmada. Protocolo ${resultado.reserva.protocolo}. O relatório está disponível no seu perfil.`,
      );
      setView("perfil");
    } catch (error) {
      setToast(normalizarErro(error).message);
    } finally {
      setCarregando(false);
    }
  }
  async function adicionarAoRoteiro(recomendacao: Recomendacao) {
    if (!selecionada) {
      setToast("Abra uma viagem para guardar essa sugestão no roteiro.");
      return;
    }
    if (recomendacao.tipo === "voo" && selecionada.orcamento?.some((item) => item.categoria === "passagem")) {
      setToast("Esta viagem já tem uma passagem. Remova a anterior na aba Orçamento antes de escolher outra.");
      return;
    }
    if (recomendacao.tipo === "hospedagem" && selecionada.orcamento?.some((item) => item.categoria === "hospedagem")) {
      setToast("Esta viagem já tem uma hospedagem. Remova a anterior na aba Orçamento antes de escolher outra.");
      return;
    }
    setCarregando(true);
    try {
      const atualizada = await adicionarRecomendacao(selecionada.id, recomendacao);
      setSelecionada(atualizada);
      setViagens((atuais) => atuais.map((item) => (item.id === atualizada.id ? atualizada : item)));
      setToast(`${recomendacao.titulo} foi adicionado ao seu roteiro.`);
    } catch (error) {
      setToast(normalizarErro(error).message);
    } finally {
      setCarregando(false);
    }
  }
  async function aplicarSugestaoOrcamento(sugestao: Partial<Record<CategoriaOrcamento, number>>) {
    if (!selecionada) {
      setToast("Abra uma viagem para salvar os valores sugeridos no orçamento.");
      return;
    }
    setCarregando(true);
    try {
      const atualizada = await definirLimitesOrcamento(selecionada.id, sugestao);
      setSelecionada(atualizada);
      setViagens((atuais) => atuais.map((item) => item.id === atualizada.id ? atualizada : item));
      setToast("Valores sugeridos pela IA salvos nas categorias do orçamento.");
    } catch (error) {
      setToast(normalizarErro(error).message);
    } finally {
      setCarregando(false);
    }
  }
  async function removerDoRoteiro(item: ItemRoteiro) {
    if (!selecionada) return;
    setCarregando(true);
    try {
      await excluirItemRoteiro(item);
      const gastoRelacionado = (selecionada.orcamento ?? []).filter((gasto) =>
        (gasto.descricao === item.titulo || gasto.descricao.startsWith(`${item.titulo} -`))
          && (gasto.categoria === "visitas" || gasto.categoria === "alimentacao" || gasto.categoria === "transporteLocal"),
      );
      await Promise.all(gastoRelacionado.map((gasto) => excluirItemOrcamento(gasto)));
      const atualizada = await obterViagem(selecionada.id);
      setSelecionada(atualizada);
      setViagens((atuais) => atuais.map((itemViagem) => itemViagem.id === atualizada.id ? atualizada : itemViagem));
      setToast("Item removido do roteiro.");
    } catch (error) {
      setToast(normalizarErro(error).message);
    } finally {
      setCarregando(false);
    }
  }
  async function removerDoOrcamento(item: ItemOrcamento) {
    if (!selecionada) return;
    setCarregando(true);
    try {
      await excluirItemOrcamento(item);
      const atualizada = await obterViagem(selecionada.id);
      setSelecionada(atualizada);
      setViagens((atuais) => atuais.map((itemViagem) => itemViagem.id === atualizada.id ? atualizada : itemViagem));
      setToast("Escolha removida do orçamento. Você pode selecionar outra oferta.");
    } catch (error) {
      setToast(normalizarErro(error).message);
    } finally {
      setCarregando(false);
    }
  }
  async function editarNoRoteiro(item: ItemRoteiro) {
    const titulo = window.prompt("Nome da atividade", item.titulo)?.trim();
    if (!titulo) return;
    const horarioInicio = window.prompt("Horário de início (HH:MM)", item.inicio)?.trim();
    if (!horarioInicio || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horarioInicio)) {
      setToast("Informe o horário no formato HH:MM.");
      return;
    }
    const [horaEditada = 0, minutoEditado = 0] = horarioInicio.split(":").map(Number);
    const minutosEditados = horaEditada * 60 + minutoEditado;
    if ((minutosEditados - 8 * 60) % 120 !== 0) {
      setToast("Escolha um horário com intervalo de 2 horas: 08:00, 10:00, 12:00, 14:00, 16:00 ou 18:00.");
      return;
    }
    const conflitoDeEspacamento = (selecionada?.roteiro ?? [])
      .filter((outro) => outro.id !== item.id && outro.dia === item.dia)
      .some((outro) => {
        const [horaOutro = 0, minutoOutro = 0] = outro.inicio.split(":").map(Number);
        return Math.abs(minutosEditados - (horaOutro * 60 + minutoOutro)) < 120;
      });
    if (conflitoDeEspacamento) {
      setToast("Mantenha pelo menos 2 horas entre o início de uma atividade e outra.");
      return;
    }
    const duracaoTexto = window.prompt("Duração em minutos", String(item.duracaoMin));
    const duracaoMinutos = Number(duracaoTexto);
    if (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0) {
      setToast("Informe uma duração maior que zero.");
      return;
    }
    setCarregando(true);
    try {
      await editarItemRoteiro(item, { titulo, horarioInicio, duracaoMinutos });
      const atualizada = await obterViagem(selecionada!.id);
      setSelecionada(atualizada);
      setViagens((atuais) => atuais.map((itemViagem) => itemViagem.id === atualizada.id ? atualizada : itemViagem));
      setToast("Atividade atualizada.");
    } catch (error) {
      setToast(normalizarErro(error).message);
    } finally {
      setCarregando(false);
    }
  }
  async function compartilharViagem(viagem: Viagem) {
    try {
      const token = await criarLinkCompartilhamento(viagem.id);
      const link = `${window.location.origin}/compartilhamento/${token}`;
      await navigator.clipboard?.writeText(link);
      setToast("Link de compartilhamento copiado.");
    } catch (error) {
      setToast(normalizarErro(error).message);
    }
  }
  function navegar(proxima: View) {
    setView(proxima);
    setMobileMenu(false);
  }

  async function alternarNotificacoes() {
    const abrir = !notificacoesAbertas;
    setNotificacoesAbertas(abrir);
    if (!abrir) return;
    try {
      setNotificacoes(await listarNotificacoes());
    } catch {
      setToast("Não foi possível atualizar suas notificações agora.");
    }
  }

  if (!usuario)
    return (
      <LoginPage
        carregando={carregando}
        mensagem={toast}
        onGoogle={() => void autenticarGoogle()}
      />
    );
  return (
    <div className="locus-app">
      <aside className={`locus-sidebar ${mobileMenu ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/assets/locus_logo.svg" alt="Locus" />
          <button
            className="icon-button mobile-only"
            aria-label="Fechar menu"
            onClick={() => setMobileMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {menu.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id || (item.id === "viagem" && view === "nova") ? "active" : ""}`}
                onClick={() => navegar(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item muted"
            onClick={() => navegar("preferencias")}
          >
            <Settings2 size={18} />
            <span>Preferências</span>
          </button>
          {usuario.papel === "admin" && (
            <button className="nav-item muted" onClick={() => navegar("admin")}>
              <ShieldCheck size={18} />
              <span>Administração</span>
            </button>
          )}
          <div className="sidebar-user">
            <Avatar nome={usuario.nome} />
            <div>
              <strong>{usuario.nome}</strong>
              <span>{usuario.email}</span>
            </div>
          </div>
          <button className="nav-item muted" onClick={() => void handleSair()}>
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="sidebar-overlay mobile-only"
          aria-label="Fechar menu"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <main className="locus-main">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Abrir menu"
            onClick={() => setMobileMenu(true)}
          >
            <Menu size={21} />
          </button>
          <div className="topbar-search">
            <Search size={17} />
            <span>Busque destinos, viagens e inspirações</span>
          </div>
          <div className="topbar-actions">
            <div className="notification-wrap">
              <button
                className="icon-button"
                aria-label="Notificações"
                onClick={() => void alternarNotificacoes()}
              >
                <Bell size={19} />
                {notificacoes.some((item) => !item.lida) && <span className="notification-dot" />}
              </button>
              {notificacoesAbertas && (
                <div className="notification-panel">
                  <div className="notification-panel-heading"><div><span className="section-label">Central</span><strong>Notificações</strong></div><button type="button" onClick={() => { void marcarTodasComoLidas().then(() => setNotificacoes((atuais) => atuais.map((item) => ({ ...item, lida: true })))); }}><CheckCheck size={15} /> Ler todas</button></div>
                  {notificacoes.length ? notificacoes.slice(0, 8).map((item) => <button className={`notification-item ${item.lida ? "is-read" : ""}`} type="button" key={item.id} onClick={() => { if (!item.lida) void marcarLida(item.id).then(() => setNotificacoes((atuais) => atuais.map((atual) => atual.id === item.id ? { ...atual, lida: true } : atual))); }}><span className="notification-item-dot" /><span><strong>{item.titulo}</strong><small>{item.texto}</small></span></button>) : <p className="notification-empty">Você ainda não tem novidades.</p>}
                </div>
              )}
            </div>
            <button className="profile-trigger" onClick={() => navegar("perfil")}>
              <Avatar nome={usuario.nome} />
              <span>{usuario.nome.split(" ")[0]}</span>
              <ChevronRight size={15} />
            </button>
          </div>
        </header>
        <div className="page-content">
          {view === "inicio" && (
            <HomeView
              viagens={viagens}
              selecionada={selecionada}
              usuario={usuario}
              relatorios={relatorios}
              onNova={() => navegar("nova")}
              onIA={() => { setDiaAssistente(undefined); navegar("ia"); }}
              onAbrir={abrirViagem}
              onPerfil={() => navegar("perfil")}
            />
          )}
          {view === "nova" && (
            <NovaViagemView
              carregando={carregando}
              onCancelar={() => navegar("inicio")}
              onCriar={async (dados) => {
                setCarregando(true);
                try {
                  const criada = await criarViagem(dados);
                  const pronta = await criarRoteiroInicial(criada);
                  setViagens((atuais) => [pronta, ...atuais]);
                  setNotificacoes(await listarNotificacoes().catch(() => []));
                  setSelecionada(pronta);
                  setToast("Viagem criada. Agora vamos montar o seu roteiro.");
                  setView("viagem");
                } catch (error) {
                  setToast(normalizarErro(error).message);
                } finally {
                  setCarregando(false);
                }
              }}
            />
          )}
          {view === "viagem" && (
            <TripView
              viagem={selecionada}
              carregando={carregando}
              onVoltar={() => navegar("inicio")}
              onIA={(dia) => { setDiaAssistente(dia); navegar("ia"); }}
              onConfirmar={() => selecionada && void confirmar(selecionada)}
              onRemoverItem={(item) => void removerDoRoteiro(item)}
              onRemoverOrcamento={(item) => void removerDoOrcamento(item)}
              onEditarItem={(item) => void editarNoRoteiro(item)}
              onCompartilhar={() => selecionada && void compartilharViagem(selecionada)}
              onAtualizar={(atualizada) => {
                setSelecionada(atualizada);
                setViagens((atuais) => atuais.map((item) => item.id === atualizada.id ? atualizada : item));
              }}
              onToast={setToast}
            />
          )}
          {view === "ia" && (
            <AssistantView
              viagem={selecionada}
              diaInicial={diaAssistente}
              onVoltar={() => navegar(selecionada ? "viagem" : "inicio")}
              onToast={setToast}
              onAdicionar={(recomendacao) => void adicionarAoRoteiro(recomendacao)}
              onAplicarOrcamento={(sugestao) => void aplicarSugestaoOrcamento(sugestao)}
            />
          )}
          {view === "perfil" && (
            <ProfileView
              usuario={usuario}
              viagens={viagens}
              relatorios={relatorios}
              onAbrir={abrirViagem}
              onPreferencias={() => navegar("preferencias")}
              onBaixar={async (relatorio) => {
                try {
                  const blob = await baixarRelatorio(relatorio);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  const viagemDoRelatorio = viagens.find((item) => item.id === relatorio.viagemId);
                  a.download = viagemDoRelatorio
                    ? nomeArquivoRoteiro(viagemDoRelatorio)
                    : campo<string>(relatorio, "nomeArquivo") ?? `locus-${relatorio.protocolo}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (error) {
                  setToast(normalizarErro(error).message);
                }
              }}
            />
          )}
          {view === "preferencias" && <PreferencesView onToast={setToast} />}
          {view === "admin" && usuario.papel === "admin" && <AdminView onToast={setToast} />}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Fechar aviso">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function LoginPage({
  carregando,
  mensagem,
  onGoogle,
}: {
  carregando: boolean;
  mensagem: string;
  onGoogle: () => void;
}) {
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="story-top">
          <img src="/assets/locus_logo.svg" alt="Locus" />
          <span className="story-badge">
            <span className="status-dot" /> Planejamento inteligente
          </span>
        </div>
        <div className="story-copy">
          <p className="eyebrow">Para onde a sua curiosidade leva?</p>
          <h1>
            Pequenos passos.
            <br />
            <em>Grandes entregas.</em>
          </h1>
          <p>
            Do primeiro “e se...” ao roteiro que faz sentido para você. O Locus combina conversa,
            mapas, orçamento e escolhas reais em uma jornada só.
          </p>
          <div className="story-points">
            <span>
              <Check size={15} /> Locus AI para decidir melhor
            </span>
            <span>
              <Check size={15} /> Roteiros por dia
            </span>
            <span>
              <Check size={15} /> Relatório PDF no perfil
            </span>
          </div>
        </div>
        <img className="story-icon" src="/assets/locus_icone.svg" alt="" />
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-logo">
            <img src="/assets/locus_logo.svg" alt="Locus" />
          </div>
          <p className="eyebrow">Seu espaço de viagem</p>
          <h2>Planeje com intenção.</h2>
          <p className="login-lead">
            Entre para continuar seus roteiros, conversar com a IA e guardar cada entrega.
          </p>
          <button className="google-button" onClick={onGoogle} disabled={carregando}>
            <GoogleMark /> {carregando ? "Abrindo o Google..." : "Continuar com Google"}
          </button>
          {mensagem && <p className="form-error">{mensagem}</p>}
        </div>
      </section>
    </main>
  );
}

function HomeView({
  viagens,
  selecionada,
  usuario,
  relatorios,
  onNova,
  onIA,
  onAbrir,
  onPerfil,
}: {
  viagens: Viagem[];
  selecionada: Viagem | null;
  usuario: Usuario;
  relatorios: Relatorio[];
  onNova: () => void;
  onIA: () => void;
  onAbrir: (viagem: Viagem) => void;
  onPerfil: () => void;
}) {
  const principal = selecionada ?? viagens[0];
  return (
    <section className="view-stack">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">
            {new Date().toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </p>
          <h1>
            Olá, {usuario.nome.split(" ")[0]}.<br />
            <span>Vamos criar algo memorável?</span>
          </h1>
          <p className="view-subtitle">O melhor roteiro começa com uma boa pergunta.</p>
        </div>
        <button className="primary-button" onClick={onNova}>
          <Plus size={18} /> Nova viagem
        </button>
      </div>
      <div className="metric-grid">
        <Metric
          icon={<MapPin size={19} />}
          label="Viagens planejadas"
          value={String(viagens.length).padStart(2, "0")}
          tone="orange"
        />
        <Metric
          icon={<Sparkles size={19} />}
          label="Roteiros criados"
          value={String(viagens.filter((item) => item.roteiro.length > 0).length).padStart(2, "0")}
          tone="purple"
        />
        <Metric
          icon={<FileText size={19} />}
          label="Relatórios salvos"
          value={String(relatorios.length).padStart(2, "0")}
          tone="green"
        />
      </div>
      <div className="home-grid">
        <div className="main-column">
          {principal ? (
            <article className="featured-trip">
              <div className="featured-top">
                <div>
                  <span className="section-label">Em destaque</span>
                  <h2>{tituloViagem(principal)}</h2>
                  <p>
                    <MapPin size={15} /> {principal.origem} <ArrowRight size={14} />{" "}
                    {principal.destino}
                  </p>
                </div>
                <span className="trip-status">Rascunho</span>
              </div>
              <div className="trip-cover">
                <div className="cover-orb orb-one" />
                <div className="cover-orb orb-two" />
                <div className="cover-content">
                  <span className="cover-kicker">
                    <Globe2 size={14} /> Próxima jornada
                  </span>
                  <strong>{principal.destino || "Seu destino"}</strong>
                  <span>
                    {dataBr(principal.dataInicio)} — {dataBr(principal.dataFim)}
                  </span>
                </div>
                <Navigation className="cover-compass" size={84} />
              </div>
              <div className="featured-footer">
                <div className="trip-facts">
                  <span>
                    <CalendarDays size={16} /> {dataBr(principal.dataInicio)}
                  </span>
                  <span>
                    <Compass size={16} /> {formatarTransporte(transporteViagem(principal))}
                  </span>
                  <span>
                    <WalletCards size={16} />{" "}
                    {totalViagem(principal) ? brl(totalViagem(principal)) : "Orçamento aberto"}
                  </span>
                </div>
                <button className="text-button" onClick={() => onAbrir(principal)}>
                  Abrir planejamento <ArrowRight size={16} />
                </button>
              </div>
            </article>
          ) : (
            <EmptyTrip onNova={onNova} />
          )}
          <div className="section-heading">
            <div>
              <span className="section-label">Seu espaço</span>
              <h2>Atalhos para continuar</h2>
            </div>
            <button className="text-button" onClick={onPerfil}>
              Ver perfil <ArrowRight size={16} />
            </button>
          </div>
          <div className="action-grid">
            <ActionCard
              icon={<Sparkles />}
              title="Conversar com a IA"
              text="Transforme uma ideia solta em possibilidades reais."
              tone="purple"
              onClick={() => onIA()}
            />
            <ActionCard
              icon={<Map />}
              title="Explorar destinos"
              text="Pesquise lugares, mapas e pontos de interesse."
              tone="green"
              onClick={onIA}
            />
            <ActionCard
              icon={<WalletCards />}
              title="Revisar orçamento"
              text="Confira limites, estimativas e escolhas do roteiro."
              tone="orange"
              onClick={() => (principal ? onAbrir(principal) : onNova)}
            />
          </div>
        </div>
        <aside className="right-column">
          <div className="side-card">
            <div className="side-card-heading">
              <div>
                <span className="section-label">Atualizações</span>
                <h3>Seu ritmo, seu roteiro</h3>
              </div>
              <Bell size={18} />
            </div>
            <div className="timeline-note">
              <span className="timeline-line" />
              <div>
                <strong>Seu espaço está pronto</strong>
                <p>Suas viagens, escolhas e entregas ficam organizadas aqui.</p>
              </div>
            </div>
            <div className="timeline-note">
              <span className="timeline-line purple" />
              <div>
                <strong>Assistente pronto</strong>
                <p>Peça alternativas, compare e ajuste sem recomeçar.</p>
              </div>
            </div>
            <div className="timeline-note">
              <span className="timeline-line green" />
              <div>
                <strong>Relatórios no perfil</strong>
                <p>Depois da simulação, o PDF fica guardado para você.</p>
              </div>
            </div>
          </div>
          <div className="side-card inspiration-card">
            <Heart size={18} />
            <span className="section-label">Uma ideia para começar</span>
            <p>“Quero uma viagem tranquila, com lugares bons para fotografar e pouca caminhada.”</p>
            <button className="text-button" onClick={onIA}>
              Levar para a IA <ArrowRight size={16} />
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function NovaViagemView({
  onCriar,
  onCancelar,
  carregando,
}: {
  onCriar: (
    dados: Pick<
      Viagem,
      | "titulo"
      | "origem"
      | "destino"
      | "dataInicio"
      | "dataFim"
      | "transporte"
      | "modoOrcamento"
      | "limites"
      | "mochilao"
    >,
  ) => Promise<void>;
  onCancelar: () => void;
  carregando: boolean;
}) {
  const [form, setForm] = useState(dataPadrao);
  function update(key: keyof typeof form, value: string) {
    setForm((atual) => ({ ...atual, [key]: value }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCriar({
      titulo: form.titulo,
      origem: form.origem,
      destino: form.destino,
      dataInicio: form.dataInicio,
      dataFim: form.dataFim,
      transporte: form.transporte,
      modoOrcamento: form.modoOrcamento,
      limites: { ...LIMITES, extras: Number(form.limiteTotal) || 0 },
      mochilao: form.mochilao,
    });
  }
  return (
    <section className="view-stack narrow-view">
      <div className="back-row">
        <button className="back-button" onClick={onCancelar}>
          <ArrowRight className="rotate-180" size={16} /> Voltar
        </button>
        <span className="step-caption">01 / 02 · Base da viagem</span>
      </div>
      <div className="form-hero">
        <div>
          <p className="eyebrow">Comece pelo essencial</p>
          <h1>Onde a sua próxima história começa?</h1>
          <p className="view-subtitle">
            Você poderá editar o roteiro, os itens e o orçamento depois.
          </p>
        </div>
        <div className="form-hero-icon">
          <Compass size={34} />
        </div>
      </div>
      <form className="trip-form surface-panel" onSubmit={(event) => void submit(event)}>
        <div className="form-section">
          <span className="section-label">Identidade</span>
          <div className="form-grid">
            <Field
              label="Nome da viagem"
              value={form.titulo}
              onChange={(value) => update("titulo", value)}
              placeholder="Ex.: Férias em família"
            />
            <LocationField
              label="De onde você sai?"
              value={form.origem}
              onChange={(value) => update("origem", value)}
              placeholder="Cidade ou aeroporto"
            />
            <LocationField
              label="Para onde você vai?"
              value={form.destino}
              onChange={(value) => update("destino", value)}
              placeholder="Cidade, país ou região"
              wide
            />
          </div>
        </div>
        <div className="form-section">
          <span className="section-label">Quando e como</span>
          <div className="form-grid">
            <Field
              label="Data de ida"
              type="date"
              value={form.dataInicio}
              onChange={(value) => update("dataInicio", value)}
            />
            <Field
              label="Data de volta"
              type="date"
              value={form.dataFim}
              onChange={(value) => update("dataFim", value)}
            />
            <SelectField
              label="Como você quer ir?"
              value={form.transporte}
              onChange={(value) => update("transporte", value)}
              options={[
                ["aviao", "Avião"],
                ["onibus", "Ônibus"],
                ["carro", "Carro"],
                ["moto", "Moto"],
                ["particular", "Veículo particular"],
              ]}
            />
          </div>
        </div>
        <div className="form-section">
          <span className="section-label">Orçamento</span>
          <div className="form-grid">
            <SelectField
              label="Modo de planejamento"
              value={form.modoOrcamento}
              onChange={(value) => update("modoOrcamento", value)}
              options={[
                ["aberto", "Aberto — decidir aos poucos"],
                ["fixo", "Fixo — respeitar um limite"],
              ]}
            />
            <Field
              label="Limite total (opcional)"
              type="number"
              value={form.limiteTotal}
              onChange={(value) => update("limiteTotal", value)}
              placeholder="R$ 0,00"
            />
          </div>
          <label className="checkbox-field"><input type="checkbox" checked={form.mochilao} onChange={(event) => setForm((atual) => ({ ...atual, mochilao: event.target.checked }))} /><span>É um mochilão com vários países ou cidades no mesmo período</span></label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={carregando || !form.destino || !form.dataInicio || !form.dataFim || (form.modoOrcamento === "fixo" && Number(form.limiteTotal) <= 0)}
          >
            {carregando ? "Criando..." : "Criar viagem"} <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </section>
  );
}

function TripView({
  viagem,
  onVoltar,
  onIA,
  onConfirmar,
  onRemoverItem,
  onRemoverOrcamento,
  onEditarItem,
  onCompartilhar,
  onAtualizar,
  onToast,
  carregando,
}: {
  viagem: Viagem | null;
  onVoltar: () => void;
  onIA: (dia?: number) => void;
  onConfirmar: () => void;
  onRemoverItem: (item: ItemRoteiro) => void;
  onRemoverOrcamento: (item: ItemOrcamento) => void;
  onEditarItem: (item: ItemRoteiro) => void;
  onCompartilhar: () => void;
  onAtualizar: (viagem: Viagem) => void;
  onToast: (value: string) => void;
  carregando: boolean;
}) {
  const [aba, setAba] = useState<"roteiro" | "orcamento" | "resumo">("roteiro");
  const [reservaAtiva, setReservaAtiva] = useState<import("@/types").Reserva | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [versaoSelecionada, setVersaoSelecionada] = useState("");
  const [comparacao, setComparacao] = useState<{ tipo: string; item: string; detalhe: string }[]>([]);
  const [salvandoVersao, setSalvandoVersao] = useState(false);
  useEffect(() => {
    if (!viagem) {
      setReservaAtiva(null);
      return;
    }
    void listarReservas(viagem.id)
      .then((reservas) => setReservaAtiva(
        [...reservas].reverse().find((item) => !String(item.status).toLowerCase().includes("cancelada")) ?? null,
      ))
      .catch(() => setReservaAtiva(null));
  }, [viagem?.id]);
  if (!viagem) return <EmptyTrip onNova={onVoltar} />;
  const viagemAtual = viagem;
  const itens = viagemAtual.roteiro ?? [];
  const diasDaViagem = viagemAtual.dataInicio && viagemAtual.dataFim
    ? Math.max(1, Math.floor((new Date(`${viagemAtual.dataFim}T12:00:00`).getTime() - new Date(`${viagemAtual.dataInicio}T12:00:00`).getTime()) / 86400000) + 1)
    : 1;
  const maiorDiaComItem = itens.reduce((maior, item) => Math.max(maior, item.dia), 0);
  const totalDias = Math.max(diasDaViagem, maiorDiaComItem);
  const dias = Array.from({ length: totalDias }, (_, index) => index + 1);
  const resumo = resumirOrcamento(
    itensParaResumo(viagemAtual),
    viagemAtual.limites ?? LIMITES,
    viagemAtual.modoOrcamento ?? "aberto",
    viagemAtual.orcamentoTotal,
  );
  async function salvarVersao() {
    setSalvandoVersao(true);
    try {
      await criarVersao(viagemAtual.id, `Versão ${new Date().toLocaleString("pt-BR")}`);
      const atualizada = await obterViagem(viagemAtual.id);
      onAtualizar(atualizada);
      onToast("Versão do roteiro salva.");
    } catch (error) {
      onToast(normalizarErro(error).message);
    } finally {
      setSalvandoVersao(false);
    }
  }
  async function comparar() {
    const versoes = viagemAtual.versoes ?? [];
    const maisRecente = versoes[0];
    if (!maisRecente || !versaoSelecionada || maisRecente.id === versaoSelecionada) {
      onToast("Salve pelo menos duas versões diferentes para comparar.");
      return;
    }
    try {
      setComparacao(await compararVersoes(versaoSelecionada, maisRecente.id));
    } catch (error) {
      onToast(normalizarErro(error).message);
    }
  }
  async function restaurar() {
    if (!versaoSelecionada || !window.confirm("Restaurar esta versão substituirá os itens atuais do roteiro. Continuar?")) return;
    try {
      onAtualizar(await restaurarVersao(viagemAtual.id, versaoSelecionada));
      setComparacao([]);
      onToast("Versão restaurada. Os itens atuais foram substituídos pela versão escolhida.");
    } catch (error) {
      onToast(normalizarErro(error).message);
    }
  }
  return (
    <section className="view-stack">
      <div className="back-row">
        <button className="back-button" onClick={onVoltar}>
          <ArrowRight className="rotate-180" size={16} /> Todas as viagens
        </button>
        <span className="trip-status">
          <span className="status-dot" /> Planejamento em andamento
        </span>
      </div>
      <div className="trip-heading">
        <div>
          <p className="eyebrow">Roteiro personalizado</p>
          <h1>{tituloViagem(viagem)}</h1>
          <p className="view-subtitle">
            <MapPin size={15} /> {viagem.origem} <ArrowRight size={14} /> {viagem.destino}{" "}
            <span className="bullet">·</span> {dataBr(viagem.dataInicio)} a {dataBr(viagem.dataFim)}
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={onCompartilhar}>
            <Share2 size={16} /> Compartilhar
          </button>
          <button className="secondary-button" onClick={() => void salvarVersao()} disabled={salvandoVersao || itens.length === 0}>
            {salvandoVersao ? "Salvando..." : "Salvar versão"}
          </button>
          <button className="secondary-button" onClick={() => onIA()}>
            <Sparkles size={17} /> Ajustar com IA
          </button>
          {reservaAtiva && !String(reservaAtiva.status).toLowerCase().includes("confirmada") && <button
            className="secondary-button"
            disabled={cancelando}
            onClick={() => {
              if (!window.confirm("Cancelar esta simulação? O roteiro e as escolhas serão mantidos.")) return;
              setCancelando(true);
              void cancelarSimulacao(String(reservaAtiva.id))
                .then(() => setReservaAtiva(null))
                .finally(() => setCancelando(false));
            }}
          >{cancelando ? "Cancelando..." : "Cancelar simulação"}</button>}
          <button
            className="primary-button"
            onClick={onConfirmar}
            disabled={carregando || itens.length === 0}
          >
            {carregando ? "Confirmando..." : "Confirmar roteiro"} <Check size={17} />
          </button>
        </div>
      </div>
      <div className="trip-tabs">
        {[
          ["roteiro", "Roteiro", Map],
          ["orcamento", "Orçamento", WalletCards],
          ["resumo", "Resumo final", FileText],
        ].map(([id, label, Icon]) => (
          <button
            key={String(id)}
            className={aba === id ? "active" : ""}
            onClick={() => setAba(id as typeof aba)}
          >
            {typeof Icon === "function" && <Icon size={17} />} {String(label)}
          </button>
        ))}
      </div>
      {(viagem.versoes?.length ?? 0) > 0 && (
        <div className="version-panel surface-panel">
          <div>
            <span className="section-label">Histórico do roteiro</span>
            <strong>Compare ou restaure uma versão salva</strong>
          </div>
          <div className="version-actions">
            <select value={versaoSelecionada} onChange={(event) => setVersaoSelecionada(event.target.value)}>
              <option value="">Escolha uma versão</option>
              {viagem.versoes.map((versao) => <option key={versao.id} value={versao.id}>Versão {versao.numero} · {new Date(versao.criadaEm).toLocaleString("pt-BR")}</option>)}
            </select>
            <button className="secondary-button" type="button" onClick={() => void comparar()}>Comparar com a atual</button>
            <button className="secondary-button" type="button" onClick={() => void restaurar()} disabled={!versaoSelecionada}>Restaurar</button>
          </div>
          {comparacao.length > 0 && <div className="version-differences">{comparacao.map((item, index) => <span key={`${item.tipo}-${item.item}-${index}`}><strong>{item.tipo}</strong> {item.item}: {item.detalhe}</span>)}</div>}
        </div>
      )}
      {aba === "roteiro" && (
        <div className="itinerary-layout">
          <div className="itinerary-main">
            {dias.length ? (
              dias.map((dia) => (
                <div className="day-card" key={dia}>
                  <div className="day-marker">
                    <span>0{dia}</span>
                    <div>
                      <strong>Dia {dia}</strong>
                      <small>{dataBr(addDays(viagem.dataInicio, dia - 1))}</small>
                    </div>
                  </div>
                  <div className="day-items">
                    {itens
                      .filter((item) => item.dia === dia)
                      .map((item) => (
                          <ItineraryItem key={item.id} item={item} onRemover={() => onRemoverItem(item)} onEditar={() => onEditarItem(item)} />
                      ))}
                    <button className="add-item-button" onClick={() => onIA(dia)}>
                      <Plus size={16} /> Adicionar atividade no Dia {dia}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyItinerary onIA={onIA} />
            )}
          </div>
          <aside className="trip-summary">
            <SummaryCard viagem={viagem} resumo={resumo} />
          </aside>
        </div>
      )}
      {aba === "orcamento" && <BudgetView viagem={viagem} resumo={resumo} onRemover={onRemoverOrcamento} />}
      {aba === "resumo" && (
        <FinalSummary
          viagem={viagem}
          resumo={resumo}
          onConfirmar={onConfirmar}
          carregando={carregando}
        />
      )}
    </section>
  );
}

function AssistantView({
  viagem,
  diaInicial,
  onVoltar,
  onToast,
  onAdicionar,
  onAplicarOrcamento,
}: {
  viagem: Viagem | null;
    diaInicial?: number | undefined;
  onVoltar: () => void;
  onToast: (value: string) => void;
  onAdicionar: (recomendacao: Recomendacao) => void;
  onAplicarOrcamento: (sugestao: Partial<Record<CategoriaOrcamento, number>>) => void;
}) {
  const [mensagens, setMensagens] = useState<MensagemAssistente[]>([
    {
      id: "welcome",
      autor: "assistente",
      texto: `Oi! Eu sou o assistente do Locus. ${viagem ? `Vamos deixar “${tituloViagem(viagem)}” mais interessante?` : "Me conte o que você imagina para a sua próxima viagem."}`,
      criadaEm: new Date().toISOString(),
    },
  ]);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [lugares, setLugares] = useState<Lugar[]>([]);
  const [streetViews, setStreetViews] = useState<Record<string, StreetViewMeta>>({});
  const [streetViewSelecionado, setStreetViewSelecionado] = useState<{
    lugar: Lugar;
    meta: StreetViewMeta;
  } | null>(null);
  const [modoVisualizacao, setModoVisualizacao] = useState<"mapa" | "streetview">("streetview");
  const [preferencias, setPreferencias] = useState<Preferencias | null>(null);
  const [hospedagemBase, setHospedagemBase] = useState<{ nome: string; lat: number; lng: number } | null>(null);
  const [rota, setRota] = useState<Trecho[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [diasSelecionados, setDiasSelecionados] = useState<Record<string, number>>({});
  const [horariosSelecionados, setHorariosSelecionados] = useState<Record<string, string>>({});
  const [diasLugares, setDiasLugares] = useState<Record<string, number>>({});
  useEffect(() => {
    void lerPreferenciasBackend().then(setPreferencias).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (diaInicial == null) return;
    setDiasSelecionados((atuais) => ({ ...atuais, __novo__: diaInicial }));
  }, [diaInicial]);
  const modoOrcamento: ModoOrcamento = viagem?.modoOrcamento ?? preferencias?.modoOrcamento ?? "aberto";
  const limiteViagem = viagem?.orcamentoTotal ?? (viagem ? Object.values(viagem.limites).reduce((total, valor) => total + Number(valor || 0), 0) : 0);
  const limitePreferencias = Number(preferencias?.limites.extras || 0);
  const limite = modoOrcamento === "fixo"
    ? (limiteViagem > 0 ? limiteViagem : limitePreferencias > 0 ? limitePreferencias : undefined)
    : undefined;
  const acumulado = viagem ? totalViagem(viagem) : 0;
  const resumoFinanceiro = viagem
    ? resumirOrcamento(
        itensParaResumo(viagem),
        viagem.limites ?? LIMITES,
        modoOrcamento,
        viagem.orcamentoTotal,
      )
    : null;
  const orcamentoDetalhado = resumoFinanceiro
    ? resumoFinanceiro.categorias
      .map((item) => `${rotuloCategoria(item.categoria)}: R$ ${item.subtotal.toFixed(2)}${item.limite > 0 ? ` de R$ ${item.limite.toFixed(2)}` : ""}`)
      .join("; ")
    : "";
  const totalDias = viagem?.dataInicio && viagem?.dataFim
    ? Math.max(1, Math.floor((new Date(`${viagem.dataFim}T12:00:00`).getTime() - new Date(`${viagem.dataInicio}T12:00:00`).getTime()) / 86400000) + 1)
    : 1;
  function diaDaRecomendacao(recomendacao: Recomendacao): number {
    return Math.max(1, Math.min(totalDias, diasSelecionados[recomendacao.id] ?? recomendacao.dia ?? diasSelecionados["__novo__"] ?? 1));
  }
  function horarioDaRecomendacao(recomendacao: Recomendacao): string {
    return horariosSelecionados[recomendacao.id] ?? recomendacao.horario ?? "08:00";
  }
  function sugestaoOrcamento(): Partial<Record<CategoriaOrcamento, number>> {
    const dias = Math.max(1, totalDias);
    const noites = Math.max(1, dias - 1);
    const modoTransporte = viagem?.transporte ?? preferencias?.transporte ?? "aviao";
    const base: Record<CategoriaOrcamento, number> = {
      passagem: modoTransporte === "onibus" ? 900 : modoTransporte === "carro" || modoTransporte === "moto" ? 650 : 2200,
      hospedagem: noites * 420,
      visitas: dias * 90,
      alimentacao: dias * 180,
      transporteLocal: dias * 70,
      extras: dias * 45,
    };
    if (limite == null || limite <= 0) return base;
    const totalBase = Object.values(base).reduce((total, valor) => total + valor, 0);
    const fator = limite / totalBase;
    return Object.fromEntries(
      Object.entries(base).map(([categoria, valor]) => [categoria, Math.max(1, Math.round(valor * fator))]),
    ) as Partial<Record<CategoriaOrcamento, number>>;
  }
  function perguntaPedeOrcamento(pergunta: string): boolean {
    return /orçamento|orcamento|quanto.*gasto|quanto.*levar|valor.*viagem|gastos?|custos?|preço total|preco total|limite por categoria|definir valores|categorias?.*(visitas|alimentação|transporte|extras)/.test(pergunta.toLowerCase());
  }
  function limitarSugestaoOrcamento(sugestao: Partial<Record<CategoriaOrcamento, number>>): Partial<Record<CategoriaOrcamento, number>> {
    const valores = Object.entries(sugestao).filter(([, valor]) => Number.isFinite(Number(valor)) && Number(valor) > 0) as [CategoriaOrcamento, number][];
    if (limite == null || limite <= 0) return Object.fromEntries(valores);
    const total = valores.reduce((soma, [, valor]) => soma + Number(valor), 0);
    if (total <= limite) return Object.fromEntries(valores);
    const fator = limite / total;
    return Object.fromEntries(valores.map(([categoria, valor]) => [categoria, Math.max(1, Math.floor(Number(valor) * fator))]));
  }
  function completarSugestaoOrcamento(sugestao: Partial<Record<CategoriaOrcamento, number>>): Partial<Record<CategoriaOrcamento, number>> {
    const base = sugestaoOrcamento();
    const resultado: Partial<Record<CategoriaOrcamento, number>> = { ...base };
    (Object.keys(base) as CategoriaOrcamento[]).forEach((categoria) => {
      const valor = Number(sugestao[categoria]);
      if (Number.isFinite(valor) && valor > 0) resultado[categoria] = valor;
    });
    return resultado;
  }
  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!texto.trim() || enviando) return;
    const pergunta = texto.trim();
    setTexto("");
    const user: MensagemAssistente = {
      id: `u-${Date.now()}`,
      autor: "usuario",
      texto: pergunta,
      criadaEm: new Date().toISOString(),
    };
    const idResposta = `a-${Date.now()}`;
    setMensagens((atuais) => [...atuais, user, {
      id: idResposta,
      autor: "assistente",
      texto: "Estou consultando o destino e os locais reais para você...",
      criadaEm: new Date().toISOString(),
    }]);
    setEnviando(true);
    try {
      const resposta = await perguntarGemini([...mensagens, user], pergunta, {
        modoOrcamento,
        limite,
        acumulado,
        orcamentoDetalhado,
        idade: preferencias?.idade,
        origem: viagem?.origem || preferencias?.origem,
        destino: viagem?.destino,
        dataInicio: viagem?.dataInicio || preferencias?.dataInicio,
        dataFim: viagem?.dataFim || preferencias?.dataFim,
        transporte: viagem?.transporte || preferencias?.transporte,
        prioridadeTransporte: preferencias?.prioridadeTransporte,
        ...(preferencias?.veiculo ? { veiculo: `${preferencias.veiculo.modelo}, ${preferencias.veiculo.combustivel}, ${preferencias.veiculo.consumoKmL} km/L` } : {}),
        interesses: preferencias?.interesses,
        ritmo: preferencias?.ritmo,
        hospedagem: preferencias?.hospedagem,
        ...(hospedagemBase ? { hospedagemBase: `${hospedagemBase.nome} (${hospedagemBase.lat}, ${hospedagemBase.lng})` } : {}),
        roteiro: viagem?.roteiro.map((item) => `dia ${item.dia}: ${item.titulo}`).join(" | "),
      });
      const destinoAtual = viagem?.destino || preferencias?.destino || "";
      const sugestaoRespostaBruta = resposta.orcamentoSugerido ?? (perguntaPedeOrcamento(pergunta) ? sugestaoOrcamento() : undefined);
      const sugestaoResposta = sugestaoRespostaBruta ? completarSugestaoOrcamento(sugestaoRespostaBruta) : undefined;
      const respostaComOrcamento: MensagemAssistente = {
        ...resposta,
        ...(sugestaoResposta
          ? {
              orcamentoSugerido: limitarSugestaoOrcamento(sugestaoResposta),
              orcamentoMoeda: moedaDoDestino(destinoAtual),
              orcamentoCambio: TAXAS_CAMBIO_REFERENCIA[moedaDoDestino(destinoAtual)],
            }
          : {}),
      };
      const destinoBusca = destinoAtual;
      const destinosBusca = separarDestinosInformados(destinoBusca);
      const consultasDaIa = (resposta.consultas ?? [])
        .map((consulta) => consulta.trim())
        .filter((consulta) => consulta.length > 4)
        .filter((consulta) => !/consultas?\s+(curtas|abaixo)|obter mais detalhes|google places$/i.test(consulta));
      const consultasDeCategorias = destinosBusca.flatMap((destino) => consultasParaLocais(pergunta, destino));
      const consultasDaIaPorDestino = destinosBusca.length
        ? consultasDaIa.flatMap((consulta) => {
            const consultaNormalizada = normalizarTextoLocal(consulta);
            const jaIndicaDestino = destinosBusca.some((destino) =>
              consultaNormalizada.includes(normalizarTextoLocal(destino)),
            );
            return jaIndicaDestino
              ? [consulta]
              : destinosBusca.map((destino) => `${consulta} em ${destino}`);
          })
        : consultasDaIa;
      const consultasPadrao = destinosBusca.length
        ? destinosBusca.map((destino) => `${pergunta} em ${destino}`)
        : [pergunta];
      const consultas = [...new Set([
        ...consultasPadrao,
        ...consultasDeCategorias,
        ...consultasDaIaPorDestino,
      ])];
      const contextoProximidade = hospedagemBase
        ? ` próximo à hospedagem ${hospedagemBase.nome}`
        : "";
      const consultasBusca = consultas.map((consulta) => {
        const consultaComBase = `${consulta}${contextoProximidade}`;
        const consultaTemDestino = destinosBusca.some((destino) =>
          normalizarTextoLocal(consultaComBase).includes(normalizarTextoLocal(destino)),
        );
        return destinoBusca && !consultaTemDestino
          ? `${consultaComBase} em ${destinoBusca}`
          : consultaComBase;
      });
      const limiteConsultasPlaces = destinosBusca.length
        ? Math.max(4, destinosBusca.length * 3)
        : 4;
      let falhasBusca = 0;
      const resultados = await Promise.all(
        consultasBusca.slice(0, limiteConsultasPlaces).map((consulta) =>
          buscaTextual(consulta).catch(() => {
            falhasBusca += 1;
            return { lugares: [], fallback: false };
          }),
        ),
      );
      const encontrados = resultados
        .flatMap((item) => item.lugares)
        .filter(lugarTemDadosReais);
      const placesEmFallback = resultados.length > 0 && resultados.every((item) => item.fallback);
      const recomendacoesDaIaComDetalhes = await Promise.all(
        (respostaComOrcamento.recomendacoes ?? [])
          .map((recomendacao) => enriquecerRecomendacaoComPlaces(recomendacao, destinoBusca)),
      );
      let respostaFinal = respostaComOrcamento;
      if (encontrados.length) {
        const unicos = [...new globalThis.Map(encontrados.map((item) => [item.placeId, item])).values()];
        const termosPedido = pergunta
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((termo) => termo.length >= 4 && !["quero", "mostre", "mostrar", "ver", "veja", "local", "lugar", "paris"].includes(termo));
        const pontuacao = (lugar: Lugar) => {
          const textoLugar = `${lugar.nome} ${lugar.endereco}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          return termosPedido.reduce((total, termo) => total + (textoLugar.includes(termo) ? 1 : 0), 0);
        };
        unicos.sort((a, b) => pontuacao(b) - pontuacao(a));
        const pedidoHospedagem = /hotel|hospedagem|pousada|hostel|resort|onde ficar/i.test(pergunta);
        const locaisRelevantes = pedidoHospedagem
          ? unicos
          : unicos.filter((lugar) => !lugarEhHospedagem(lugar));
        const proximos = hospedagemBase
          ? locaisRelevantes.filter((lugar) => distanciaKm(hospedagemBase, lugar) <= 20)
          : locaisRelevantes;
        const organizados = ordenarLugares(proximos, hospedagemBase ?? undefined).slice(0, 12);
        setLugares(organizados);
        setStreetViews({});
        if (organizados.length && (organizados.length > 1 || hospedagemBase)) {
          const pontosRota = [
            ...(hospedagemBase ? [{ lat: hospedagemBase.lat, lng: hospedagemBase.lng, nome: hospedagemBase.nome }] : []),
            ...organizados.slice(0, 6).map((item) => ({ lat: item.lat, lng: item.lng, nome: item.nome })),
          ];
          const trechos = await calcularRota(pontosRota).catch(() => []);
          setRota(trechos);
        } else {
          setRota([]);
        }
        const diasDeViagem = viagem?.dataInicio && viagem?.dataFim
          ? Math.max(1, Math.floor((new Date(`${viagem.dataFim}T12:00:00`).getTime() - new Date(`${viagem.dataInicio}T12:00:00`).getTime()) / 86400000) + 1)
          : 1;
        const recomendacoesReais: Recomendacao[] = organizados.slice(0, 12).map((lugar, index) => {
          const estimativa = estimativaLocal(lugar);
          const estimativas = estimativasDoLocal(lugar, destinoBusca);
          const valorDaCategoria = estimativas.custos[estimativa.categoria]?.valorBrl ?? estimativa.valor;
          const custoPrincipal = estimativas.custos[estimativa.categoria];
          return {
          id: `lugar-${lugar.placeId}`,
          placeId: lugar.placeId,
          tipo: "lugar",
          titulo: lugar.nome,
          resumo: `${lugar.categoria} · ${lugar.endereco || "localização consultada"}${lugar.avaliacao ? ` · ★ ${lugar.avaliacao.toFixed(1)}` : ""}${valorDaCategoria > 0 && custoPrincipal ? ` · ${formatarMoeda(custoPrincipal.valor, custoPrincipal.moeda)} ≈ ${brl(valorDaCategoria)} (${estimativa.rotulo})` : ` · ${estimativa.rotulo}`}`,
          justificativa: `${hospedagemBase ? `${distanciaKm(hospedagemBase, lugar).toFixed(1)} km da hospedagem ${hospedagemBase.nome}. ` : ""}Local confirmado pelo Google Places, com coordenadas para abrir o mapa e o Street View no ponto correto. O valor é uma estimativa e será somado somente se você adicionar o local.`,
          evidencia: { fonte: lugar.fonte, consultadoEm: lugar.consultadoEm },
          categoria: estimativa.categoria,
          custos: estimativas.custos,
          ...(valorDaCategoria > 0 ? { valor: valorDaCategoria } : {}),
          natureza: valorDaCategoria > 0 ? "estimado" : "observado",
          ...(lugar.avaliacao ? { avaliacao: lugar.avaliacao } : {}),
          ...(lugar.endereco ? { endereco: lugar.endereco } : {}),
          ...(Number.isFinite(lugar.lat) ? { lat: lugar.lat } : {}),
          ...(Number.isFinite(lugar.lng) ? { lng: lugar.lng } : {}),
          categoriaLocal: lugar.categoria,
          ...(hospedagemBase ? { distanciaKm: distanciaKm(hospedagemBase, lugar) } : {}),
          dia: Math.min(diasDeViagem, Math.floor(index / 3) + 1),
          };
        });
        const recomendacoesDaIaComCustos = recomendacoesDaIaComDetalhes
          .filter((recomendacao): recomendacao is Recomendacao => Boolean(recomendacao))
          .map((recomendacao) => {
          const lugar = lugarDaRecomendacao(recomendacao);
          if (!lugar) return recomendacao;
          const estimativas = estimativasDoLocal(lugar, destinoBusca);
          return {
            ...recomendacao,
            custos: recomendacao.custos ?? estimativas.custos,
          };
        });
        const recomendacoesComDetalhes = [...recomendacoesReais, ...recomendacoesDaIaComCustos]
          .filter((recomendacao, index, todas) => {
            const titulo = recomendacao.titulo.trim().toLocaleLowerCase();
            return todas.findIndex((candidata) => {
              const mesmaIdentidade = recomendacao.placeId && candidata.placeId
                ? recomendacao.placeId === candidata.placeId
                : candidata.titulo.trim().toLocaleLowerCase() === titulo;
              return mesmaIdentidade;
            }) === index;
          })
          .slice(0, 12);
        respostaFinal = {
          ...respostaComOrcamento,
          texto: organizados.length
            ? `${resposta.texto} Encontrei ${organizados.length} locais reais${hospedagemBase ? ` em até 20 km da hospedagem ${hospedagemBase.nome}` : ""}. Cada resultado inclui avaliação quando disponível, endereço e coordenadas para abrir o mapa e o Street View no ponto correto.`
            : `Não encontrei pontos turísticos dentro de 20 km da hospedagem ${hospedagemBase?.nome ?? "selecionada"}. Vou evitar sugerir locais distantes; pesquise um bairro ou local específico no campo ao lado.`,
          ...(recomendacoesComDetalhes.length ? { recomendacoes: recomendacoesComDetalhes } : {}),
        };
      } else {
        setLugares([]);
        setRota([]);
        const recomendacoesDaIaComCustos = recomendacoesDaIaComDetalhes
          .filter((recomendacao): recomendacao is Recomendacao => Boolean(recomendacao))
          .map((recomendacao) => {
          const lugar = lugarDaRecomendacao(recomendacao);
          if (!lugar) return recomendacao;
          return {
            ...recomendacao,
            custos: recomendacao.custos ?? estimativasDoLocal(lugar, destinoBusca).custos,
          };
        });
        const possuiRecomendacoesDaIa = Boolean(recomendacoesDaIaComCustos?.length);
        respostaFinal = {
          ...respostaComOrcamento,
          ...(recomendacoesDaIaComCustos?.length ? { recomendacoes: recomendacoesDaIaComCustos } : {}),
          texto: falhasBusca || placesEmFallback
            ? `${respostaComOrcamento.texto} ${possuiRecomendacoesDaIa ? "A IA encontrou recomendações confirmadas com nome, endereço e coordenadas reais." : "A consulta automática de lugares está temporariamente indisponível; tente novamente em alguns segundos."}`
            : possuiRecomendacoesDaIa
              ? `${respostaComOrcamento.texto} Os locais exibidos foram confirmados com nome, endereço e coordenadas reais.`
              : `${respostaComOrcamento.texto} Não encontrei resultados para essa busca no destino informado. Tente citar uma praia, museu, bairro ou ponto turístico específico.`,
        };
      }
      setMensagens((atuais) => atuais.map((item) => item.id === idResposta ? { ...respostaFinal, id: idResposta } : item));
    } catch {
      // O chat continua útil mesmo quando o provedor de IA ou uma consulta
      // secundária falha. A busca real do Google Places é independente da
      // resposta textual e pode preencher os cartões dentro da conversa.
      const destinoBusca = viagem?.destino || preferencias?.destino || "";
      const fallback = respostaLocalAssistente(pergunta, {
        modoOrcamento,
        limite,
        acumulado,
        orcamentoDetalhado,
        destino: destinoBusca,
        origem: viagem?.origem || preferencias?.origem,
        dataInicio: viagem?.dataInicio || preferencias?.dataInicio,
        dataFim: viagem?.dataFim || preferencias?.dataFim,
        interesses: preferencias?.interesses,
        ritmo: preferencias?.ritmo,
        hospedagem: preferencias?.hospedagem,
        ...(hospedagemBase ? { hospedagemBase: hospedagemBase.nome } : {}),
      });
      if (fallback.orcamentoSugerido) {
        fallback.orcamentoSugerido = limitarSugestaoOrcamento(completarSugestaoOrcamento(fallback.orcamentoSugerido));
        const moeda = moedaDoDestino(destinoBusca);
        fallback.orcamentoMoeda = moeda;
        fallback.orcamentoCambio = TAXAS_CAMBIO_REFERENCIA[moeda];
      }
      try {
        const destinosFallback = separarDestinosInformados(destinoBusca);
        const consultasFallback = destinosFallback.flatMap((destino) => consultasParaLocais(pergunta, destino));
        const consultasPadraoFallback = destinosFallback.length
          ? destinosFallback.map((destino) => `${pergunta} em ${destino}`)
          : [pergunta];
        const resultado = await Promise.all(
          [...new Set([...consultasPadraoFallback, ...consultasFallback])]
            .slice(0, Math.max(6, destinosFallback.length * 3))
            .map((consulta) => buscaTextual(consulta).catch(() => ({ lugares: [], fallback: false }))),
        ).then((resultados) => ({ lugares: resultados.flatMap((item) => item.lugares).filter(lugarTemDadosReais) }));
        const pedidoHospedagem = /hotel|hospedagem|pousada|hostel|resort|onde ficar/i.test(pergunta);
        const locaisRelevantes = pedidoHospedagem
          ? resultado.lugares
          : resultado.lugares.filter((lugar) => !lugarEhHospedagem(lugar));
        const locais = ordenarLugares(
          hospedagemBase
            ? locaisRelevantes.filter((lugar) => distanciaKm(hospedagemBase, lugar) <= 20)
            : locaisRelevantes,
          hospedagemBase ?? undefined,
        ).slice(0, 6);
        setLugares(locais);
        const recomendacoes: Recomendacao[] = locais.map((lugar, index) => {
          const estimativa = estimativaLocal(lugar);
          const estimativas = estimativasDoLocal(lugar, destinoBusca);
          const valorDaCategoria = estimativas.custos[estimativa.categoria]?.valorBrl ?? estimativa.valor;
          return {
          id: `fallback-${lugar.placeId}`,
          placeId: lugar.placeId,
          tipo: "lugar",
          titulo: lugar.nome,
          resumo: `${lugar.categoria} · ${lugar.endereco}${lugar.avaliacao ? ` · ★ ${lugar.avaliacao.toFixed(1)}` : ""} · custos estimados em ${estimativas.custos.visitas?.moeda ?? "USD"}`,
          justificativa: hospedagemBase
            ? `${distanciaKm(hospedagemBase, lugar).toFixed(1)} km da hospedagem. Confira no Street View antes de escolher. O valor é uma estimativa.`
            : "Resultado real consultado no Google Places. Confira no Street View antes de escolher. O valor é uma estimativa.",
          evidencia: { fonte: lugar.fonte, consultadoEm: lugar.consultadoEm },
          categoria: estimativa.categoria,
          custos: estimativas.custos,
          ...(valorDaCategoria > 0 ? { valor: valorDaCategoria } : {}),
          natureza: valorDaCategoria > 0 ? "estimado" : "observado",
          ...(lugar.avaliacao ? { avaliacao: lugar.avaliacao } : {}),
          ...(lugar.endereco ? { endereco: lugar.endereco } : {}),
          lat: lugar.lat,
          lng: lugar.lng,
          categoriaLocal: lugar.categoria,
          ...(hospedagemBase ? { distanciaKm: distanciaKm(hospedagemBase, lugar) } : {}),
          dia: Math.min(viagem?.dataInicio && viagem?.dataFim ? Math.max(1, Math.floor((new Date(`${viagem.dataFim}T12:00:00`).getTime() - new Date(`${viagem.dataInicio}T12:00:00`).getTime()) / 86400000) + 1) : 1, Math.floor(index / 3) + 1),
          };
        });
        if (recomendacoes.length) {
          fallback.recomendacoes = recomendacoes;
          fallback.texto = `${fallback.texto} Encontrei ${recomendacoes.length} locais reais no Google Places. Abra o Street View e escolha pelo próprio chat.`;
        }
      } catch {
        // A mensagem local ainda é entregue mesmo sem o provedor externo.
      }
      setMensagens((atuais) => atuais.map((item) => item.id === idResposta ? { ...fallback, id: idResposta } : item));
    } finally {
      setEnviando(false);
    }
  }
  async function pesquisar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busca.trim()) return;
    try {
      const destinoBusca = viagem?.destino || preferencias?.destino || "";
      const resultado = await buscaTextual(destinoBusca ? `${busca} em ${destinoBusca}` : busca);
      const proximos = hospedagemBase
        ? resultado.lugares.filter((lugar) => distanciaKm(hospedagemBase, lugar) <= 20)
        : resultado.lugares;
      const organizados = ordenarLugares(proximos, hospedagemBase ?? undefined);
      setLugares(organizados);
      if (!organizados.length) {
        onToast(hospedagemBase
          ? "Nenhum resultado ficou até 20 km da hospedagem escolhida. Pesquise outro local ou bairro próximo."
          : "Nenhum local real foi encontrado para essa busca.");
      }
      if (organizados.length && (organizados.length > 1 || hospedagemBase)) {
        const pontosRota = [
          ...(hospedagemBase ? [{ lat: hospedagemBase.lat, lng: hospedagemBase.lng, nome: hospedagemBase.nome }] : []),
          ...organizados.slice(0, 6).map((item) => ({ lat: item.lat, lng: item.lng, nome: item.nome })),
        ];
        const trechos = await calcularRota(pontosRota).catch(() => []);
        setRota(trechos);
      } else {
        setRota([]);
      }
      setStreetViews({});
    } catch (error) {
      onToast(normalizarErro(error).message);
    }
  }
  async function resolverLugarComCoordenadas(lugar: Lugar): Promise<Lugar | null> {
    const possuiDadosReais = lugar.fonte === "Google Places"
      && parecePlaceIdGoogle(lugar.placeId)
      && Boolean(lugar.endereco?.trim())
      && Number.isFinite(lugar.lat)
      && Number.isFinite(lugar.lng)
      && !(lugar.lat === 0 && lugar.lng === 0);
    if (possuiDadosReais) return lugar;
    const destinoAtual = viagem?.destino || preferencias?.destino || "";
    const consulta = [lugar.nome, lugar.endereco, destinoAtual].filter(Boolean).join(", ");
    if (!consulta) return null;
    const resultado = await buscaTextual(consulta).catch(() => ({ lugares: [], fallback: false }));
    return resultado.lugares.find(lugarTemDadosReais) ?? null;
  }
  async function visualizarLugar(lugar: Lugar, modo: "mapa" | "streetview") {
    const lugarResolvido = await resolverLugarComCoordenadas(lugar);
    if (!lugarResolvido) {
      onToast("Não encontrei coordenadas confiáveis para este local. Pesquise a cidade, o país ou o endereço completo.");
      return;
    }
    setModoVisualizacao(modo);
    const metaExistente = streetViews[lugarResolvido.placeId];
    if (metaExistente && (modo === "mapa" || metaExistente.status !== "PENDING")) {
      setStreetViewSelecionado({ lugar: lugarResolvido, meta: metaExistente });
      return;
    }
    if (modo === "mapa") {
      const meta: StreetViewMeta = { status: "PENDING" };
      setStreetViews((atual) => ({ ...atual, [lugarResolvido.placeId]: meta }));
      setStreetViewSelecionado({ lugar: lugarResolvido, meta });
      return;
    }
    // O modal usa a Maps Embed API diretamente. O Google escolhe a
    // panorâmica mais próxima a partir das coordenadas, sem consultar a API
    // Street View no backend e sem abrir uma nova aba.
    const meta: StreetViewMeta = { status: "READY" };
    setStreetViews((atual) => ({ ...atual, [lugarResolvido.placeId]: meta }));
    setStreetViewSelecionado({ lugar: lugarResolvido, meta });
  }
  function revisarLugar(lugar: Lugar, _recomendacao?: Recomendacao) {
    void visualizarLugar(lugar, "streetview");
  }
  function abrirMapaLugar(lugar: Lugar) {
    void visualizarLugar(lugar, "mapa");
  }
  function abrirMapaOferta(hotel: import("@/types").OfertaHotel) {
    if (hotel.latitude == null || hotel.longitude == null) {
      onToast("Esta hospedagem ainda não possui coordenadas para o mapa.");
      return;
    }
    setModoVisualizacao("mapa");
    setStreetViewSelecionado({
      lugar: {
        placeId: hotel.id,
        nome: hotel.hotel,
        endereco: hotel.endereco || viagem?.destino || "Destino da viagem",
        categoria: "Hospedagem",
        lat: hotel.latitude,
        lng: hotel.longitude,
        fonte: hotel.fonte,
        consultadoEm: hotel.consultadoEm,
        demonstrativo: hotel.fonte !== "Google Places",
      },
      meta: { status: "PENDING" },
    });
  }
  function distanciaTexto(lugar: Lugar): string {
    const referencia = hospedagemBase ?? lugares[0];
    if (!referencia || ("placeId" in referencia && referencia.placeId === lugar.placeId)) return "Ponto de referência";
    const distancia = distanciaKm(referencia, lugar);
    const leitura = distancia <= 10 ? "perto" : distancia <= 30 ? "viável com deslocamento" : "longe; melhor separar em outro dia";
    return `${distancia.toFixed(1)} km ${hospedagemBase ? "da hospedagem" : "do primeiro ponto"} · ${leitura}`;
  }
  function lugarDaRecomendacao(recomendacao: Recomendacao): Lugar | null {
    const encontrado = recomendacao.placeId
      ? lugares.find((item) => item.placeId === recomendacao.placeId)
      : undefined;
    if (encontrado) return encontrado;
    if (parecePlaceIdGoogle(recomendacao.placeId)
      && Boolean(recomendacao.endereco?.trim())
      && Number.isFinite(recomendacao.lat)
      && Number.isFinite(recomendacao.lng)
      && !(recomendacao.lat === 0 && recomendacao.lng === 0)) {
      return {
        placeId: recomendacao.placeId!,
        nome: recomendacao.titulo,
        endereco: recomendacao.endereco!,
        categoria: recomendacao.categoriaLocal ?? "Ponto de interesse",
        ...(recomendacao.avaliacao != null ? { avaliacao: recomendacao.avaliacao } : {}),
        lat: recomendacao.lat!,
        lng: recomendacao.lng!,
        fonte: recomendacao.evidencia.fonte,
        consultadoEm: recomendacao.evidencia.consultadoEm,
        demonstrativo: false,
      };
    }
    return null;
  }
  function lugarTemDadosReais(lugar: Lugar | null | undefined): lugar is Lugar {
    return Boolean(lugar
      && parecePlaceIdGoogle(lugar.placeId)
      && lugar.endereco?.trim()
      && Number.isFinite(lugar.lat)
      && Number.isFinite(lugar.lng)
      && !(lugar.lat === 0 && lugar.lng === 0)
      && lugar.fonte === "Google Places");
  }
  function normalizarTextoLocal(valor: string): string {
    return valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  }
  function pontuarCandidatoLocal(lugar: Lugar, recomendacao: Recomendacao, destino: string): number {
    const consulta = normalizarTextoLocal(`${recomendacao.titulo} ${recomendacao.endereco ?? ""}`);
    const textoCandidato = normalizarTextoLocal(`${lugar.nome} ${lugar.endereco}`);
    const tokens = consulta.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
    const coincidencias = tokens.reduce((total, token) => total + (textoCandidato.includes(token) ? 1 : 0), 0);
    const nomeRecomendado = normalizarTextoLocal(recomendacao.titulo);
    const nomeEncontrado = normalizarTextoLocal(lugar.nome);
    const nomeExato = nomeEncontrado.includes(nomeRecomendado) || nomeRecomendado.includes(nomeEncontrado);
    const destinoEncontrado = destino
      ? textoCandidato.includes(normalizarTextoLocal(destino))
      : false;
    return coincidencias + (nomeExato ? 8 : 0) + (destinoEncontrado ? 2 : 0);
  }
  async function resolverRecomendacaoComPlaces(
    recomendacao: Recomendacao,
    destino: string,
  ): Promise<Lugar | null> {
    const consultas = [...new Set([
      [recomendacao.titulo, recomendacao.endereco, destino].filter(Boolean).join(", "),
      [recomendacao.titulo, destino].filter(Boolean).join(", "),
      [recomendacao.consulta, destino].filter(Boolean).join(", "),
    ].filter((consulta) => consulta.trim().length > 4))];
    for (const consulta of consultas) {
      const resultado = await buscaTextual(consulta).catch(() => ({ lugares: [], fallback: false }));
      const candidatos = resultado.lugares.filter(lugarTemDadosReais);
      if (candidatos.length) {
        return [...candidatos].sort((a, b) =>
          pontuarCandidatoLocal(b, recomendacao, destino) - pontuarCandidatoLocal(a, recomendacao, destino),
        )[0] ?? null;
      }
    }
    return null;
  }
  async function enriquecerRecomendacaoComPlaces(
    recomendacao: Recomendacao,
    destino: string,
  ): Promise<Recomendacao | null> {
    const ehLocal = recomendacao.tipo === "lugar"
      || recomendacao.tipo === "atividade"
      || recomendacao.tipo === "hospedagem";
    if (!ehLocal) return recomendacao;
    const lugar = await resolverRecomendacaoComPlaces(recomendacao, destino);
    if (!lugar) return null;
    const estimativa = estimativaLocal(lugar);
    const estimativas = estimativasDoLocal(lugar, destino);
    const valorDaCategoria = estimativas.custos[estimativa.categoria]?.valorBrl ?? estimativa.valor;
    const custoPrincipal = estimativas.custos[estimativa.categoria];
    return {
      ...recomendacao,
      titulo: lugar.nome,
      resumo: `${lugar.categoria} · ${lugar.endereco}${lugar.avaliacao != null ? ` · ${estrelasAvaliacao(lugar.avaliacao)}` : ""}${valorDaCategoria > 0 && custoPrincipal ? ` · ${formatarMoeda(custoPrincipal.valor, custoPrincipal.moeda)} ≈ ${brl(valorDaCategoria)}` : ""}`,
      justificativa: "Local confirmado pelo Google Places, com endereço e coordenadas para abrir o mapa e o Street View no ponto correto.",
      consulta: `${lugar.nome}, ${lugar.endereco}`,
      evidencia: { fonte: "Google Places", consultadoEm: lugar.consultadoEm },
      placeId: lugar.placeId,
      endereco: lugar.endereco,
      lat: lugar.lat,
      lng: lugar.lng,
      categoriaLocal: lugar.categoria,
      ...(lugar.avaliacao != null ? { avaliacao: lugar.avaliacao } : {}),
      custos: recomendacao.custos ?? estimativas.custos,
      categoria: recomendacao.categoria ?? estimativa.categoria,
      ...(valorDaCategoria > 0 && recomendacao.valor == null ? { valor: valorDaCategoria } : {}),
    };
  }
  function adicionarLugar(lugar: Lugar) {
    if (!streetViews[lugar.placeId]) {
      onToast("Confira o Street View antes de adicionar este lugar ao roteiro.");
      void revisarLugar(lugar);
      return;
    }
    const estimativa = estimativaLocal(lugar);
    const estimativas = estimativasDoLocal(lugar, viagem?.destino || "");
    const valorDaCategoria = estimativas.custos[estimativa.categoria]?.valorBrl ?? estimativa.valor;
    adicionarRecomendacaoControlada({
      id: `lugar-${lugar.placeId}`,
      tipo: "lugar",
      titulo: lugar.nome,
      resumo: `${lugar.categoria} · ${lugar.endereco}`,
      justificativa: "Lugar consultado no Google Places e escolhido por você.",
      evidencia: { fonte: lugar.fonte, consultadoEm: lugar.consultadoEm },
      placeId: lugar.placeId,
      ...(lugar.avaliacao ? { avaliacao: lugar.avaliacao } : {}),
      ...(lugar.endereco ? { endereco: lugar.endereco } : {}),
      lat: lugar.lat,
      lng: lugar.lng,
      categoriaLocal: lugar.categoria,
      custos: estimativas.custos,
      ...(valorDaCategoria > 0 ? { valor: valorDaCategoria } : {}),
      categoria: estimativa.categoria,
      natureza: valorDaCategoria > 0 ? "estimado" : "observado",
      dia: diasLugares[lugar.placeId] ?? 1,
    });
  }
  function adicionarRecomendacaoControlada(recomendacao: Recomendacao) {
    if (limite != null && Number(recomendacao.valor || 0) > Math.max(0, limite - acumulado)) {
      onToast("Essa recomendação ultrapassa o saldo restante do seu orçamento.");
      return;
    }
    let recomendacaoFinal = recomendacao;
    if (viagem && (recomendacao.tipo === "lugar" || recomendacao.tipo === "atividade")) {
      const totalDias = viagem.dataInicio && viagem.dataFim
        ? Math.max(1, Math.floor((new Date(`${viagem.dataFim}T12:00:00`).getTime() - new Date(`${viagem.dataInicio}T12:00:00`).getTime()) / 86400000) + 1)
        : 1;
      let dia = Math.max(1, Math.min(totalDias, recomendacao.dia ?? 1));
      while (dia < totalDias && (viagem.roteiro ?? []).filter((item) => item.dia === dia).length >= 4) dia += 1;
      if ((viagem.roteiro ?? []).filter((item) => item.dia === dia).length >= 4) {
        onToast("Este roteiro já tem 4 atividades por dia. Remova uma ou escolha outro dia.");
        return;
      }
      if (dia !== (recomendacao.dia ?? 1)) {
        recomendacaoFinal = { ...recomendacao, dia };
        onToast(`O Dia ${recomendacao.dia ?? 1} está cheio. Esta atividade será sugerida para o Dia ${dia}.`);
      }
    }
    if (recomendacao.tipo === "hospedagem" && recomendacao.lat != null && recomendacao.lng != null) {
      setHospedagemBase({ nome: recomendacao.titulo, lat: recomendacao.lat, lng: recomendacao.lng });
      onToast(`Hospedagem escolhida. As próximas recomendações ficarão em até 20 km dela.`);
    }
    onAdicionar(recomendacaoFinal);
  }
  return (
    <section className="view-stack">
      <div className="back-row">
        <button className="back-button" onClick={onVoltar}>
          <ArrowRight className="rotate-180" size={16} /> Voltar
        </button>
        <span className="ai-live">
          <span className="pulse-dot" /> Seu assistente de viagem
        </span>
      </div>
      <div className="assistant-heading">
        <div>
          <p className="eyebrow">Conversa contínua</p>
          <h1>Ideias que encontram um caminho.</h1>
          <p className="view-subtitle">
            Pergunte, compare e refine. A IA mantém o contexto enquanto você decide.
          </p>
        </div>
        <div className="assistant-heading-mark">
          <Sparkles size={28} />
        </div>
      </div>
      <div className="assistant-layout">
        <div className="chat-panel">
          <div className="chat-header">
            <div className="assistant-avatar">
              <Sparkles size={18} />
            </div>
            <div>
              <strong>Assistente Locus</strong>
              <span>Respostas apoiadas por dados consultados</span>
            </div>
            <span className="chat-online">online</span>
          </div>
          {resumoFinanceiro && (
            <div className="chat-budget-context">
              <strong>Orçamento acompanhado pela IA</strong>
              <span>{resumoFinanceiro.categorias.map((item) => `${rotuloCategoria(item.categoria)} ${brl(item.subtotal)}`).join(" · ")}</span>
              <small>
                Total acumulado: {brl(resumoFinanceiro.total)}
                {resumoFinanceiro.saldo != null ? ` · Saldo: ${brl(Math.max(0, resumoFinanceiro.saldo))}` : " · orçamento aberto"}
              </small>
            </div>
          )}
          <div className="chat-messages">
            {mensagens.map((mensagem) => (
              <div
                key={mensagem.id}
                className={`message-row ${mensagem.autor === "usuario" ? "from-user" : "from-ai"}`}
              >
                <div className="message-bubble">
                  <p>{mensagem.texto}</p>
                  {mensagem.orcamentoSugerido && (
                    <div className="chat-budget-suggestion">
                      <strong>Estimativa inicial por categoria</strong>
                      <div className="chat-budget-suggestion-grid">
                        {CATEGORIAS.map(({ id, rotulo }) => {
                          const valor = mensagem.orcamentoSugerido?.[id];
                          if (valor == null) return null;
                          const moeda = mensagem.orcamentoMoeda ?? "BRL";
                          const cambio = mensagem.orcamentoCambio || TAXAS_CAMBIO_REFERENCIA[moeda];
                          return (
                            <span key={id}>
                              <small>{rotulo}</small>
                              <b>{brl(valor)}</b>
                              {moeda !== "BRL" && <em>{formatarMoeda(valor / cambio, moeda)} · câmbio de referência</em>}
                            </span>
                          );
                        })}
                      </div>
                      <small>Valores em reais para o orçamento do Locus, com referência em {mensagem.orcamentoMoeda ?? "BRL"}. Alimentação, transporte local e extras entram na estimativa mesmo antes de você escolher cada atividade.</small>
                      <button
                        type="button"
                        className="recommendation-action recommendation-add"
                        disabled={!viagem}
                        onClick={() => onAplicarOrcamento(mensagem.orcamentoSugerido ?? {})}
                      >
                        <WalletCards size={14} /> {viagem ? "Aplicar valores ao orçamento" : "Crie uma viagem para aplicar"}
                      </button>
                    </div>
                  )}
                  {mensagem.recomendacoes?.map((recomendacao) => (
                    <div className="recommendation" key={recomendacao.id}>
                      <div>
                        <strong>{recomendacao.titulo}</strong>
                        {recomendacao.avaliacao != null && (
                          <span className="recommendation-rating" aria-label={`Avaliação ${recomendacao.avaliacao.toFixed(1)} de 5`}>
                            {estrelasAvaliacao(recomendacao.avaliacao)}
                          </span>
                        )}
                        <span>{recomendacao.resumo}</span>
                        <small className="recommendation-address">
                          {recomendacao.endereco
                            ? `Endereço: ${recomendacao.endereco}`
                            : `Busca no Google: ${recomendacao.consulta || recomendacao.titulo}`}
                        </small>
                        <small>
                          {recomendacao.categoriaLocal ? `${recomendacao.categoriaLocal} · ` : ""}
                          {recomendacao.dia ? `Dia ${recomendacao.dia} · ` : ""}
                          {recomendacao.distanciaKm != null ? `${recomendacao.distanciaKm.toFixed(1)} km da hospedagem · ` : ""}
                          {recomendacao.justificativa} · {recomendacao.evidencia.fonte}
                          {recomendacao.valor ? ` · ${brl(recomendacao.valor)}` : ""}
                        </small>
                        {recomendacao.custos && (
                          <div className="recommendation-costs">
                            <strong>Estimativa por pessoa</strong>
                            <div className="recommendation-cost-grid">
                              {(["visitas", "alimentacao", "transporteLocal", "extras"] as CategoriaOrcamento[]).map((categoria) => {
                                const custo = recomendacao.custos?.[categoria];
                                if (!custo) return null;
                                return (
                                  <span key={categoria}>
                                    <small>{CATEGORIAS.find((item) => item.id === categoria)?.rotulo ?? categoria}</small>
                                    <b>{formatarMoeda(custo.valor, custo.moeda)}</b>
                                    <em>≈ {brl(custo.valorBrl)}</em>
                                  </span>
                                );
                              })}
                            </div>
                            <small>Estimativa de referência; confirme o preço no local. O equivalente em reais usa o câmbio configurado no frontend.</small>
                          </div>
                        )}
                      </div>
                      {(recomendacao.tipo === "lugar" || recomendacao.tipo === "atividade") && viagem && (
                        <div className="recommendation-schedule">
                          <label className="recommendation-day-picker">
                            <span>Dia</span>
                            <select
                              value={diaDaRecomendacao(recomendacao)}
                              onChange={(event) => setDiasSelecionados((atuais) => ({
                                ...atuais,
                                [recomendacao.id]: Number(event.target.value),
                              }))}
                            >
                              {Array.from({ length: totalDias }, (_, index) => index + 1).map((dia) => (
                                <option key={dia} value={dia}>Dia {dia}</option>
                              ))}
                            </select>
                          </label>
                          <label className="recommendation-day-picker">
                            <span>Horário</span>
                            <select
                              value={horarioDaRecomendacao(recomendacao)}
                              onChange={(event) => setHorariosSelecionados((atuais) => ({
                                ...atuais,
                                [recomendacao.id]: event.target.value,
                              }))}
                            >
                              {HORARIOS_ROTEIRO.map((horario) => <option key={horario} value={horario}>{horario}</option>)}
                            </select>
                          </label>
                        </div>
                      )}
                      {(() => {
                        const lugar = lugarDaRecomendacao(recomendacao);
                        return (
                          <div className="recommendation-actions">
                            {lugar ? (
                              <>
                                <button type="button" className="recommendation-action"
                                  onClick={() => void revisarLugar(lugar, recomendacao)}>
                                  <Eye size={15} /> Visualizar
                                </button>
                                <button type="button" className="recommendation-action recommendation-add"
                                  onClick={() => adicionarRecomendacaoControlada({
                                    ...recomendacao,
                                    ...(recomendacao.tipo === "lugar" || recomendacao.tipo === "atividade"
                                      ? { dia: diaDaRecomendacao(recomendacao), horario: horarioDaRecomendacao(recomendacao) }
                                      : {}),
                                  })}>
                                  <Plus size={15} /> Adicionar
                                </button>
                              </>
                            ) : (
                              <span className="recommendation-unavailable">Aguardando consulta do local</span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                  {mensagem.autor === "assistente" && mensagem.recomendacoes?.length ? (() => {
                    const lugaresDaMensagem = mensagem.recomendacoes
                      .map((recomendacao) => lugarDaRecomendacao(recomendacao))
                      .filter((lugar): lugar is Lugar => Boolean(lugar));
                    return lugaresDaMensagem.length ? (
                      <div className="chat-map-preview">
                        <MapPreview
                          lugares={lugaresDaMensagem.slice(0, 6)}
                          onVisualizarMapa={abrirMapaLugar}
                          onVisualizarStreetView={revisarLugar}
                        />
                      </div>
                    ) : null;
                  })() : null}
                </div>
              </div>
            ))}
            {enviando && (
              <div className="message-row from-ai">
                <div className="message-bubble typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
          <form className="chat-input" onSubmit={(event) => void enviar(event)}>
            <input
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              placeholder="Ex.: quero um dia tranquilo perto do mar..."
            />
            <button aria-label="Enviar mensagem" disabled={enviando || !texto.trim()}>
              <ArrowRight size={19} />
            </button>
          </form>
        </div>
        <aside className="assistant-side">
          <PlanningFlow
            viagem={viagem}
            etapaInicial="passagem"
            limite={limite}
            acumulado={acumulado}
            onToast={onToast}
            onAdicionar={adicionarRecomendacaoControlada}
            onVisualizarMapa={abrirMapaOferta}
          />
          <div className="side-card search-card">
            <div className="side-card-heading">
              <div>
                <span className="section-label">Explorar</span>
                <h3>Lugares para considerar</h3>
              </div>
              <MapPin size={18} />
            </div>
            <form className="place-search" onSubmit={(event) => void pesquisar(event)}>
              <Search size={16} />
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Pesquisar um lugar"
              />
            </form>
            {lugares.length ? (
              <>
                <MapPreview
                  lugares={lugares.slice(0, 4)}
                  onVisualizarMapa={abrirMapaLugar}
                  onVisualizarStreetView={revisarLugar}
                />
                <div className="place-results">
                  {lugares.slice(0, 4).map((lugar) => (
                    <div
                      key={lugar.placeId}
                      className="place-result"
                    >
                      <span className="place-icon">
                        <MapPin size={15} />
                      </span>
                      <span>
                        <strong>{lugar.nome}</strong>
                        <small>
                          {lugar.categoria}{lugar.avaliacao ? ` · ★ ${lugar.avaliacao.toFixed(1)}` : ""} · {distanciaTexto(lugar)}
                        </small>
                      </span>
                      <div className="place-actions">
                        {viagem && (
                          <label className="place-day-picker">
                            <span>Dia</span>
                            <select
                              value={diasLugares[lugar.placeId] ?? 1}
                              onChange={(event) => setDiasLugares((atuais) => ({
                                ...atuais,
                                [lugar.placeId]: Number(event.target.value),
                              }))}
                            >
                              {Array.from({ length: totalDias }, (_, index) => index + 1).map((dia) => (
                                <option key={dia} value={dia}>{dia}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <button type="button" onClick={() => void revisarLugar(lugar)}>Street View</button>
                        <button type="button" onClick={() => adicionarLugar(lugar)}>{streetViews[lugar.placeId] ? "Adicionar" : "Ver antes"}</button>
                      </div>
                    </div>
                  ))}
                </div>
                {rota.length > 0 && (
                  <div className="route-preview">
                    <strong>Rota sugerida por proximidade</strong>
                    {rota.map((trecho) => <span key={`${trecho.de}-${trecho.para}`}>{trecho.de} → {trecho.para}: {trecho.km.toFixed(1)} km · {trecho.minutos} min</span>)}
                  </div>
                )}
                {lugares.slice(0, 4).map((lugar) => {
                  const streetView = streetViews[lugar.placeId];
                  if (!streetView) return null;
                  return (
                    <div className="street-view-preview" key={`${lugar.placeId}-street-view`}>
                      <div>
                        <strong>Antes de escolher: {lugar.nome}</strong>
                        <small>
                          {streetView.status === "OK"
                            ? "Imagem consultada no Google Street View"
                            : "Sem imagem disponível para este ponto"}
                        </small>
                      </div>
                      <button className="secondary-button compact-button" type="button" onClick={() => void revisarLugar(lugar)}>
                        <Eye size={14} /> Ver no modal
                      </button>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="search-empty">
                <MapPin size={20} />
                <p>Pesquise praias, museus, restaurantes, hotéis e pontos turísticos.</p>
              </div>
            )}
          </div>
          <div className="side-card context-card">
            <span className="section-label">Contexto desta conversa</span>
            <div className="context-tags">
              <span>Preferências</span>
              <span>Datas</span>
              <span>Orçamento</span>
              <span>Ritmo</span>
            </div>
            <p>
              A resposta da IA é um apoio à decisão. Confirme sempre os dados da oferta antes da
              simulação.
            </p>
          </div>
        </aside>
      </div>
      {streetViewSelecionado && (
        <div className="street-view-modal-backdrop" role="presentation" onClick={() => setStreetViewSelecionado(null)}>
          <div className="street-view-modal location-modal" role="dialog" aria-modal="true" aria-labelledby="street-view-modal-title" onClick={(event) => event.stopPropagation()}>
            <button className="street-view-modal-close" type="button" onClick={() => setStreetViewSelecionado(null)} aria-label="Fechar Street View">
              <X size={18} />
            </button>
            <span className="section-label">Visualização dentro do Locus</span>
            <h2 id="street-view-modal-title">{streetViewSelecionado.lugar.nome}</h2>
            <p>{streetViewSelecionado.lugar.endereco}</p>
            <div className="location-modal-tabs" role="tablist" aria-label="Visualização do local">
              <button type="button" className={modoVisualizacao === "mapa" ? "active" : ""} onClick={() => setModoVisualizacao("mapa")}><Map size={15} /> Mapa</button>
              <button type="button" className={modoVisualizacao === "streetview" ? "active" : ""} onClick={() => setModoVisualizacao("streetview")}><Eye size={15} /> Street View</button>
            </div>
            {modoVisualizacao === "mapa" ? (
              <GoogleEmbedMap
                nome={streetViewSelecionado.lugar.nome}
                endereco={streetViewSelecionado.lugar.endereco}
                placeId={streetViewSelecionado.lugar.placeId}
                lat={streetViewSelecionado.lugar.lat}
                lng={streetViewSelecionado.lugar.lng}
              />
            ) : (
              <GoogleStreetView
                lat={streetViewSelecionado.lugar.lat}
                lng={streetViewSelecionado.lugar.lng}
                imagemUrl={streetViewSelecionado.meta.imagemUrl}
                className="street-view-frame location-modal-view"
              />
            )}
            <div className="street-view-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setStreetViewSelecionado(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ProfileView({
  usuario,
  viagens,
  relatorios,
  onAbrir,
  onPreferencias,
  onBaixar,
}: {
  usuario: Usuario;
  viagens: Viagem[];
  relatorios: Relatorio[];
  onAbrir: (viagem: Viagem) => void;
  onPreferencias: () => void;
  onBaixar: (relatorio: Relatorio) => Promise<void>;
}) {
  return (
    <section className="view-stack">
      <div className="profile-hero">
        <div className="profile-hero-avatar">
          <Avatar nome={usuario.nome} large />
        </div>
        <div>
          <p className="eyebrow">Área pessoal</p>
          <h1>{usuario.nome}</h1>
          <p className="view-subtitle">
            {usuario.email} <span className="bullet">·</span> Viajante Locus
          </p>
        </div>
        <button className="secondary-button profile-edit" onClick={onPreferencias}>
          <Settings2 size={17} /> Preferências
        </button>
      </div>
      <div className="profile-grid">
        <div className="profile-main">
          <div className="section-heading">
            <div>
              <span className="section-label">Histórico</span>
              <h2>Minhas viagens</h2>
            </div>
            <span className="count-pill">{viagens.length}</span>
          </div>
          {viagens.length ? (
            <div className="profile-trips">
              {viagens.map((viagem) => (
                <button className="profile-trip" key={viagem.id} onClick={() => onAbrir(viagem)}>
                  <span className="profile-trip-icon">
                    <MapPin size={18} />
                  </span>
                  <span>
                    <strong>{tituloViagem(viagem)}</strong>
                    <small>
                      {viagem.destino} · {dataBr(viagem.dataInicio)} a {dataBr(viagem.dataFim)}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyTrip onNova={() => undefined} />
          )}
        </div>
        <div className="profile-main">
          <div className="section-heading">
            <div>
              <span className="section-label">Entregas</span>
              <h2>Relatórios em PDF</h2>
            </div>
            <FileText size={20} />
          </div>
          {relatorios.length ? (
            <div className="report-list">
              {relatorios.map((relatorio) => (
                <div className="report-item" key={relatorio.id}>
                  <span className="report-icon">
                    <FileText size={18} />
                  </span>
                  <div>
                    <strong>
                      {(relatorio.nomeArquivo || `Relatório ${relatorio.id}`).replace(/\.pdf$/i, "")}
                    </strong>
                    <small>
                      {relatorio.protocolo ? `Protocolo ${relatorio.protocolo} · ` : ""}
                      Gerado em{" "}
                      {new Date(
                        relatorio.geradoEm || String(campo(relatorio, "dataGeracao") ?? ""),
                      ).toLocaleDateString("pt-BR")}
                    </small>
                  </div>
                  <button
                    className="download-button"
                    onClick={() => void onBaixar(relatorio)}
                    aria-label="Baixar relatório"
                  >
                    <Download size={17} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="report-empty">
              <FileText size={24} />
              <strong>Nenhum relatório ainda</strong>
              <p>Depois de confirmar uma simulação, o PDF completo da viagem aparecerá aqui.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function SummaryCard({
  viagem,
  resumo,
}: {
  viagem: Viagem;
  resumo: ReturnType<typeof resumirOrcamento>;
}) {
  return (
    <div className="summary-card">
      <div className="summary-title">
        <span className="section-label">Visão geral</span>
        <WalletCards size={18} />
      </div>
      <strong className="summary-total">{resumo.total ? brl(resumo.total) : "Aberto"}</strong>
      <span className="summary-caption">estimativa acumulada</span>
      <div className="summary-bars">
        {resumo.categorias.slice(0, 4).map((item) => (
          <div key={item.categoria} className="bar-row">
            <span>{rotuloCategoria(item.categoria)}</span>
            <div>
              <i
                style={{
                  width: `${Math.min(100, item.subtotal && resumo.total ? (item.subtotal / resumo.total) * 100 : 4)}%`,
                }}
              />
            </div>
            <b>{item.subtotal ? brl(item.subtotal) : "—"}</b>
          </div>
        ))}
      </div>
      <div className="summary-divider" />
      <div className="summary-meta">
        <span>
          <Compass size={15} /> {formatarTransporte(transporteViagem(viagem))}
        </span>
        <span>
          <CalendarDays size={15} /> {dataBr(viagem.dataInicio)}
        </span>
      </div>
    </div>
  );
}
function BudgetView({
  viagem,
  resumo,
  onRemover,
}: {
  viagem: Viagem;
  resumo: ReturnType<typeof resumirOrcamento>;
  onRemover: (item: ItemOrcamento) => void;
}) {
  return (
    <div className="budget-page">
      <div className="budget-total surface-panel">
        <span className="section-label">Total acumulado</span>
        <strong>{resumo.total ? brl(resumo.total) : "R$ 0,00"}</strong>
        <p>
          {viagem.modoOrcamento === "fixo"
            ? "Comparado ao limite definido"
            : "O orçamento será construído conforme suas escolhas"}
        </p>
      </div>
      <div className="budget-categories">
        {resumo.categorias.map((item) => (
          <div className="budget-category surface-panel" key={item.categoria}>
            <div>
              <span className="budget-dot" />
              <strong>{rotuloCategoria(item.categoria)}</strong>
            </div>
            <b>{brl(item.subtotal > 0 ? item.subtotal : item.limite > 0 ? item.limite : 0)}</b>
            <small>{item.limite ? `${item.subtotal > 0 ? "Limite" : "Meta sugerida"} ${brl(item.limite)}` : "Sem limite definido"}</small>
          </div>
        ))}
      </div>
      <div className="budget-items surface-panel">
        <div className="summary-title">
          <span className="section-label">Escolhas adicionadas</span>
          <WalletCards size={18} />
        </div>
        {viagem.orcamento?.length ? viagem.orcamento.map((item) => (
          <div className="budget-item-row" key={item.id}>
            <div>
              <strong>{item.descricao}</strong>
              <small>{rotuloCategoria(item.categoria)} · {item.natureza}</small>
            </div>
            <b>{brl(item.valor)}</b>
            <button className="icon-button danger-icon" type="button" onClick={() => onRemover(item)} aria-label={`Remover ${item.descricao}`}><Trash2 size={14} /></button>
          </div>
        )) : <p>Nenhuma passagem ou hospedagem foi adicionada ainda.</p>}
      </div>
    </div>
  );
}
function FinalSummary({
  viagem,
  resumo,
  onConfirmar,
  carregando,
}: {
  viagem: Viagem;
  resumo: ReturnType<typeof resumirOrcamento>;
  onConfirmar: () => void;
  carregando: boolean;
}) {
  return (
    <div className="final-summary surface-panel">
      <div className="final-summary-top">
        <div>
          <span className="section-label">Quase lá</span>
          <h2>Revise antes de confirmar</h2>
          <p>
            Esta etapa cria uma reserva acadêmica simulada, gera um protocolo e monta o relatório
            PDF.
          </p>
        </div>
        <CheckCircle2 size={40} />
      </div>
      <div className="review-grid">
        <Review label="Destino" value={viagem.destino} />
        <Review
          label="Período"
          value={`${dataBr(viagem.dataInicio)} — ${dataBr(viagem.dataFim)}`}
        />
        <Review label="Transporte" value={formatarTransporte(transporteViagem(viagem))} />
        <Review label="Total estimado" value={resumo.total ? brl(resumo.total) : "A definir"} />
      </div>
      <div className="simulation-note">
        <Sparkles size={18} />
        <span>
          Nenhuma compra real é realizada. O Locus apenas registra a simulação e guarda o PDF no seu
          perfil.
        </span>
      </div>
      <button className="primary-button" onClick={onConfirmar} disabled={carregando}>
        {carregando ? "Gerando entrega..." : "Confirmar e gerar meu PDF"} <ArrowRight size={17} />
      </button>
    </div>
  );
}
function Review({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value || "—"}</strong>
    </div>
  );
}
function ItineraryItem({ item, onRemover, onEditar }: { item: ItemRoteiro; onRemover: () => void; onEditar: () => void }) {
  return (
    <div className="itinerary-item">
      <div className="item-time">{item.inicio}</div>
      <div className="item-connector">
        <span />
      </div>
      <div className="item-content">
        <div>
          <strong>{item.titulo}</strong>
          <p>{item.endereco || "Ponto do roteiro"}</p>
        </div>
        <div className="item-tags">
          <span>{item.duracaoMin} min</span>
          {item.favorito && <Heart size={15} fill="currentColor" />}
          <button className="icon-button" type="button" onClick={onEditar} aria-label={`Editar ${item.titulo}`}><Pencil size={14} /></button>
          <button className="icon-button danger-icon" type="button" onClick={onRemover} aria-label={`Remover ${item.titulo} do roteiro`}><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}
function EmptyItinerary({ onIA }: { onIA: () => void }) {
  return (
    <div className="empty-state surface-panel">
      <Map size={30} />
      <h3>Seu roteiro ainda está em branco.</h3>
      <p>Converse com a IA para montar uma primeira proposta por dia.</p>
      <button className="primary-button" onClick={onIA}>
        <Sparkles size={17} /> Pedir uma sugestão
      </button>
    </div>
  );
}
function EmptyTrip({ onNova }: { onNova: () => void }) {
  return (
    <div className="empty-state surface-panel">
      <Compass size={30} />
      <h3>Seu espaço começa aqui.</h3>
      <p>Crie uma viagem para organizar destino, roteiro, orçamento e entrega.</p>
      <button className="primary-button" onClick={onNova}>
        <Plus size={17} /> Criar uma viagem
      </button>
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
function ActionCard({
  icon,
  title,
  text,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className={`action-card ${tone}`} onClick={onClick}>
      <span className="action-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <ArrowRight size={17} />
    </button>
  );
}
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={label !== "Limite total (opcional)"}
      />
    </label>
  );
}

function LocationField({
  label,
  value,
  onChange,
  placeholder,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<{ id: string; texto: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    let ativo = true;
    const timer = window.setTimeout(() => {
      void autocomplete(query)
        .then((items) => {
          if (!ativo) return;
          setSuggestions(items);
          setOpen(items.length > 0);
        })
        .catch(() => {
          if (!ativo) return;
          setSuggestions([]);
          setOpen(false);
        });
    }, 300);

    return () => {
      ativo = false;
      window.clearTimeout(timer);
    };
  }, [value]);

  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      {label}
      <div className="autocomplete-wrap">
        <input
          type="text"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(suggestions.length > 0)}
          onBlur={() => window.setTimeout(() => setOpen(false), 180)}
          placeholder={placeholder}
          autoComplete="off"
          required
        />
        {open && suggestions.length > 0 ? (
          <div className="autocomplete-list" role="listbox">
            {suggestions.map((item) => (
              <button
                key={item.id || item.texto}
                type="button"
                className="autocomplete-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(item.texto);
                  setSuggestions([]);
                  setOpen(false);
                }}
              >
                <MapPin size={14} />
                <span>{item.texto}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[][];
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function Avatar({ nome, large = false }: { nome: string; large?: boolean }) {
  return (
    <span className={`avatar ${large ? "large" : ""}`}>
      {nome
        .split(" ")
        .map((item) => item[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="google-mark">
      <path
        fill="#4285F4"
        d="M21.35 12.27c0-.68-.06-1.34-.18-1.97H12v3.73h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.15Z"
      />
      <path
        fill="#34A853"
        d="M12 21.8c2.63 0 4.84-.87 6.45-2.38l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.8Z"
      />
      <path
        fill="#FBBC05"
        d="M6.54 13.86A5.85 5.85 0 0 1 6.23 12c0-.65.11-1.28.31-1.86V7.61H3.3A9.75 9.75 0 0 0 2.27 12c0 1.57.38 3.05 1.03 4.39l3.24-2.53Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.11c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.16 14.63 2.2 12 2.2a9.74 9.74 0 0 0-8.7 5.41l3.24 2.53c.77-2.31 2.92-4.03 5.46-4.03Z"
      />
    </svg>
  );
}
function addDays(date: string, days: number): string {
  if (!date) return "";
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export default App;
