import { useEffect, useState, type FormEvent } from "react";
import { BedDouble, Check, ExternalLink, MapPin, Plane, Search, Sparkles, X } from "lucide-react";
import { autocomplete, buscarHoteis, buscarLocalizacoes, buscarVoos } from "@/services/integracoes";
import type { CategoriaOrcamento, OfertaHotel, OfertaVoo, Recomendacao, Viagem } from "@/types";

type Etapa = "passagem" | "hospedagem" | "roteiro";
type OfertaSelecionada =
  | { tipo: "voo"; valor: OfertaVoo }
  | { tipo: "hospedagem"; valor: OfertaHotel };

const dinheiro = (valor: number, moeda: string) => {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL" }).format(valor);
  } catch {
    return `${moeda || "BRL"} ${valor.toFixed(2)}`;
  }
};

function codigoIata(valor: string | undefined, fallback: string): string {
  const normalizado = (valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const conhecidos: Record<string, string> = {
    "sao paulo": "GRU",
    "sao paulo, sp": "GRU",
    salvador: "SSA",
    "salvador, ba": "SSA",
    curacao: "CUR",
    "willemstad, curacao": "CUR",
    lisboa: "LIS",
    "lisboa, portugal": "LIS",
    portugal: "LIS",
    madeira: "FNC",
    "ilha da madeira": "FNC",
    "ilha da madeira, portugal": "FNC",
    funchal: "FNC",
    recife: "REC",
    "rio de janeiro": "GIG",
    fortaleza: "FOR",
    natal: "NAT",
  };
  if (conhecidos[normalizado]) return conhecidos[normalizado];
  if (normalizado.includes("madeira") || normalizado.includes("funchal")) return "FNC";
  if (normalizado.includes("salvador")) return "SSA";
  if (normalizado.includes("lisboa") || normalizado === "portugal") return "LIS";
  if (normalizado.includes("curacao") || normalizado.includes("willemstad")) return "CUR";
  if (/^[a-z]{3}$/.test(normalizado)) return normalizado.toUpperCase();
  return fallback;
}

async function resolverCodigoIata(valor: string, fallback = ""): Promise<string> {
  const direto = codigoIata(valor, "");
  if (direto) return direto;
  const resultados = await buscarLocalizacoes(valor).catch(() => []);
  if (resultados[0]?.iataCode) return resultados[0].iataCode;

  // O catálogo de ofertas do Locus é demonstrativo e também precisa aceitar
  // países/cidades que ainda não possuem um apelido IATA cadastrado. O código
  // abaixo só identifica a consulta simulada; não é apresentado como aeroporto
  // real nem é enviado a um provedor comercial.
  const simulado = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
  return simulado.length === 3 ? simulado : fallback;
}

function LocationSuggest({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [suggestions, setSuggestions] = useState<{ id: string; texto: string }[]>([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2 || Boolean(codigoIata(query, ""))) {
      setSuggestions([]);
      setAberto(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void autocomplete(query)
        .then((items) => {
          setSuggestions(items);
          setAberto(items.length > 0);
        })
        .catch(() => {
          setSuggestions([]);
          setAberto(false);
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [value]);

  return (
    <label>
      {label}
      <div className="autocomplete-wrap">
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(suggestions.length > 0)}
          onBlur={() => window.setTimeout(() => setAberto(false), 180)}
          placeholder={placeholder}
          autoComplete="off"
        />
        {aberto && suggestions.length > 0 && (
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
                  setAberto(false);
                }}
              >
                <MapPin size={14} /> <span>{item.texto}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

function valorInicialLocal(valor: string | undefined, fallback: string): string {
  return codigoIata(valor, "") || valor || fallback;
}

function recomendacaoOferta(
  tipo: "voo" | "hospedagem",
  titulo: string,
  resumo: string,
  valor: number,
  fonte: string,
  categoria: CategoriaOrcamento,
  localizacao?: { lat?: number; lng?: number; endereco?: string },
): Recomendacao {
  return {
    id: `${tipo}-${Date.now()}`,
    tipo,
    titulo,
    resumo,
    justificativa: "Escolhida por você na consulta de ofertas.",
    evidencia: { fonte, consultadoEm: new Date().toISOString() },
    ...(valor > 0 ? { valor } : {}),
    ...(localizacao?.lat != null ? { lat: localizacao.lat } : {}),
    ...(localizacao?.lng != null ? { lng: localizacao.lng } : {}),
    ...(localizacao?.endereco ? { endereco: localizacao.endereco } : {}),
    categoria,
    natureza: fonte.includes("simulado") ? "simulado" : "observado",
  };
}

export function PlanningFlow({
  viagem,
  etapaInicial,
  limite,
  acumulado = 0,
  onToast,
  onAdicionar,
}: {
  viagem: Viagem | null;
  etapaInicial: "passagem" | "hospedagem" | "roteiro" | "geral";
  limite: number | undefined;
  acumulado?: number;
  onToast: (value: string) => void;
  onAdicionar: (recomendacao: Recomendacao) => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>(etapaInicial === "hospedagem" ? "hospedagem" : etapaInicial === "roteiro" ? "roteiro" : "passagem");
  const [origem, setOrigem] = useState(valorInicialLocal(viagem?.origem, "GRU"));
  const [destino, setDestino] = useState(valorInicialLocal(viagem?.destino, ""));
  const [ida, setIda] = useState(viagem?.dataInicio || "");
  const [volta, setVolta] = useState(viagem?.dataFim || "");
  const [cidade, setCidade] = useState(valorInicialLocal(viagem?.destino, ""));
  const [entrada, setEntrada] = useState(viagem?.dataInicio || "");
  const [saida, setSaida] = useState(viagem?.dataFim || "");
  const [pessoas, setPessoas] = useState(1);
  const [quartos, setQuartos] = useState(1);
  const [voos, setVoos] = useState<OfertaVoo[]>([]);
  const [hoteis, setHoteis] = useState<OfertaHotel[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [ofertaSelecionada, setOfertaSelecionada] = useState<OfertaSelecionada | null>(null);
  const restante = limite == null ? undefined : Math.max(0, limite - acumulado);
  const passagemAdicionada = Boolean(viagem?.orcamento?.some((item) => item.categoria === "passagem"));
  const hospedagemAdicionada = Boolean(viagem?.orcamento?.some((item) => item.categoria === "hospedagem"));

  useEffect(() => {
    if (!viagem || !cidade || !entrada || !saida) return;
    let ativo = true;
    setCarregando(true);
    void resolverCodigoIata(cidade)
      .then((cityCode) => cityCode
        ? buscarHoteis({ cityCode, checkInDate: entrada, checkOutDate: saida, adults: pessoas, roomQuantity: quartos })
        : [])
      .then((resultado) => {
        if (ativo) setHoteis(resultado);
      })
      .catch(() => undefined)
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [viagem?.id, cidade, entrada, saida, pessoas, quartos]);

  function podeAdicionar(valor: number): boolean {
    return restante == null || valor <= restante;
  }

  function adicionarVoo(voo: OfertaVoo) {
    if (passagemAdicionada) {
      onToast("Você já adicionou uma passagem. Remova a anterior na aba Orçamento para escolher outra.");
      return;
    }
    if (!podeAdicionar(voo.preco)) {
      onToast("Essa opção ultrapassa o limite restante do seu orçamento. Escolha outra oferta.");
      return;
    }
    setOfertaSelecionada({ tipo: "voo", valor: voo });
  }

  function adicionarHotel(hotel: OfertaHotel) {
    if (hospedagemAdicionada) {
      onToast("Você já adicionou uma hospedagem. Remova a anterior na aba Orçamento para escolher outra.");
      return;
    }
    if (hotel.preco > 0 && !podeAdicionar(hotel.preco)) {
      onToast("Essa hospedagem ultrapassa o limite restante do seu orçamento. Escolha outra oferta.");
      return;
    }
    setOfertaSelecionada({ tipo: "hospedagem", valor: hotel });
  }

  function confirmarOferta() {
    if (!ofertaSelecionada) return;
    if (ofertaSelecionada.tipo === "voo") {
      const voo = ofertaSelecionada.valor;
      onAdicionar(recomendacaoOferta("voo", `Passagem ${voo.origem} → ${voo.destino}`, `${voo.companhia} · ${dinheiro(voo.preco, voo.moeda)}`, voo.preco, voo.fonte, "passagem"));
    } else {
      const hotel = ofertaSelecionada.valor;
      onAdicionar(recomendacaoOferta("hospedagem", hotel.hotel, `${hotel.quarto} · ${hotel.preco ? dinheiro(hotel.preco, hotel.moeda) : "Oferta consultada"}`, hotel.preco, hotel.fonte, "hospedagem", {
        ...(hotel.latitude != null ? { lat: hotel.latitude } : {}),
        ...(hotel.longitude != null ? { lng: hotel.longitude } : {}),
        endereco: hotel.hotel,
      }));
    }
    setOfertaSelecionada(null);
    onToast("Oferta adicionada ao roteiro. O total foi atualizado.");
  }

  async function pesquisarVoos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!origem || !destino || !ida || !volta) {
      onToast("Informe origem, destino, ida e volta para consultar uma passagem de ida e volta.");
      return;
    }
    if (volta <= ida) {
      onToast("A data de volta precisa ser posterior à data de ida.");
      return;
    }
    setCarregando(true);
    try {
      const [origemCode, destinoCode] = await Promise.all([resolverCodigoIata(origem), resolverCodigoIata(destino)]);
      if (!origemCode || !destinoCode) {
        onToast("Informe uma cidade ou código IATA reconhecido para origem e destino.");
        return;
      }
      const resultado = await buscarVoos({ originLocationCode: origemCode, destinationLocationCode: destinoCode, departureDate: ida, returnDate: volta, adults: pessoas, max: 6 });
      setVoos(resultado);
      onToast(resultado.length ? "Passagens encontradas. Abra uma opção para conferir os detalhes." : "Nenhuma passagem encontrada para esses filtros.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível consultar as passagens.");
    } finally {
      setCarregando(false);
    }
  }

  async function pesquisarHoteis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cidade || !entrada || !saida) {
      onToast("Informe destino e as datas da hospedagem.");
      return;
    }
    setCarregando(true);
    try {
      const cityCode = await resolverCodigoIata(cidade);
      if (!cityCode) {
        onToast("Informe uma cidade ou código IATA reconhecido para buscar hospedagens.");
        return;
      }
      if (saida <= entrada) {
        onToast("A saída precisa ser posterior à entrada para calcular as noites.");
        return;
      }
      const resultado = await buscarHoteis({ cityCode, checkInDate: entrada, checkOutDate: saida, adults: pessoas, roomQuantity: quartos });
      setHoteis(resultado);
      onToast(resultado.length ? "Hospedagens encontradas. Abra uma opção para ver a imagem." : "Nenhuma hospedagem encontrada para esses filtros.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível consultar as hospedagens.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="planning-flow side-card">
      <div className="side-card-heading">
        <div>
          <span className="section-label">Planejamento guiado</span>
          <h3>Passagem, hospedagem e roteiro</h3>
          <small className="planning-source">A fonte e a data da consulta aparecem em cada opção. Confirme disponibilidade antes de comprar.</small>
        </div>
        <Sparkles size={18} />
      </div>
      <div className="planning-budget">
        <span>{limite == null ? "Orçamento aberto" : `Saldo disponível ${dinheiro(restante ?? 0, "BRL")}`}</span>
        <strong>{dinheiro(acumulado, "BRL")} acumulado</strong>
      </div>
      <div className="planning-steps">
        {(["passagem", "hospedagem", "roteiro"] as Etapa[]).map((item, index) => (
          <button key={item} className={etapa === item ? "active" : ""} type="button" onClick={() => setEtapa(item)}>
            <span>{index + 1}</span>{item === "passagem" ? "Passagem" : item === "hospedagem" ? "Hospedagem" : "Roteiro"}
          </button>
        ))}
      </div>
      {etapa === "passagem" && (
        <form className="planning-form" onSubmit={(event) => void pesquisarVoos(event)}>
          <div className="form-grid compact">
            <LocationSuggest label="Origem" value={origem} onChange={setOrigem} placeholder="SSA ou Salvador" />
            <LocationSuggest label="Destino" value={destino} onChange={setDestino} placeholder="CUR ou Curaçao" />
          </div>
          <div className="form-grid compact">
            <label>Ida<input type="date" value={ida} onChange={(event) => setIda(event.target.value)} /></label>
            <label>Volta<input type="date" value={volta} onChange={(event) => setVolta(event.target.value)} /></label>
          </div>
          <label>Viajantes<input type="number" min="1" max="20" value={pessoas} onChange={(event) => setPessoas(Math.max(1, Number(event.target.value) || 1))} /></label>
          <button className="secondary-button full-button" disabled={carregando || passagemAdicionada} type="submit"><Search size={15} />{passagemAdicionada ? "Passagem adicionada" : carregando ? "Consultando..." : "Buscar passagens"}</button>
          {voos.map((voo) => {
            const acima = !podeAdicionar(voo.preco) || passagemAdicionada;
            return <div className={`offer-result ${acima ? "over-budget" : ""}`} key={voo.id}>
              <div><strong>{voo.companhia}</strong><small>{voo.origem} → {voo.destino} · Ida e volta · {voo.passageiros} viajante(s) · {voo.fonte}</small></div>
              <b>{dinheiro(voo.preco, voo.moeda)}</b>
              <button type="button" disabled={acima} onClick={() => adicionarVoo(voo)}><Check size={14} />{passagemAdicionada ? "Já adicionada" : acima ? "Acima do limite" : "Ver e escolher"}</button>
            </div>;
          })}
        </form>
      )}
      {etapa === "hospedagem" && (
        <form className="planning-form" onSubmit={(event) => void pesquisarHoteis(event)}>
          <LocationSuggest label="Destino" value={cidade} onChange={setCidade} placeholder="CUR ou Curaçao" />
          <div className="form-grid compact">
            <label>Entrada<input type="date" value={entrada} onChange={(event) => setEntrada(event.target.value)} /></label>
            <label>Saída<input type="date" value={saida} onChange={(event) => setSaida(event.target.value)} /></label>
          </div>
          <div className="form-grid compact">
            <label>Hóspedes<input type="number" min="1" max="20" value={pessoas} onChange={(event) => setPessoas(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>Quartos<input type="number" min="1" max="10" value={quartos} onChange={(event) => setQuartos(Math.max(1, Number(event.target.value) || 1))} /></label>
          </div>
          <button className="secondary-button full-button" disabled={carregando || hospedagemAdicionada} type="submit"><Search size={15} />{hospedagemAdicionada ? "Hospedagem adicionada" : carregando ? "Consultando..." : "Buscar hospedagens"}</button>
          <div className="hotel-offers">
            {hoteis.map((hotel) => {
              const acima = (hotel.preco > 0 && !podeAdicionar(hotel.preco)) || hospedagemAdicionada;
              return <div className={`hotel-offer ${acima ? "over-budget" : ""}`} key={hotel.id}>
                {hotel.imagemUrl && <img src={hotel.imagemUrl} alt={`Imagem de ${hotel.hotel}`} />}
                <div className="hotel-offer-body"><strong>{hotel.hotel}</strong><small>{hotel.checkin} → {hotel.checkout} · {hotel.noites ?? "—"} noite(s) · {hotel.hospedes} hóspede(s) · {hotel.fonte}</small><b>{hotel.preco ? dinheiro(hotel.preco, hotel.moeda) : "Consultar"}</b><button type="button" disabled={acima} onClick={() => adicionarHotel(hotel)}><BedDouble size={14} />{hospedagemAdicionada ? "Já adicionada" : acima ? "Acima do limite" : "Ver e escolher"}</button></div>
              </div>;
            })}
          </div>
        </form>
      )}
      {etapa === "roteiro" && <div className="planning-next-step"><Plane size={20} /><p>Escolha os lugares buscados pela IA ou pesquise ao lado. O Locus organiza os pontos próximos e calcula o deslocamento antes de adicionar ao roteiro.</p></div>}
      {ofertaSelecionada && (
        <div className="offer-modal-backdrop" role="dialog" aria-modal="true" aria-label="Detalhes da oferta">
          <div className="offer-modal">
            <button className="offer-modal-close" type="button" onClick={() => setOfertaSelecionada(null)} aria-label="Fechar"><X size={17} /></button>
            {ofertaSelecionada.tipo === "hospedagem" ? <>
              {ofertaSelecionada.valor.imagemUrl && <img className="offer-modal-image" src={ofertaSelecionada.valor.imagemUrl} alt={`Imagem de ${ofertaSelecionada.valor.hotel}`} />}
              <span className="section-label">Hospedagem</span>
              <h3>{ofertaSelecionada.valor.hotel}</h3>
              <p>{ofertaSelecionada.valor.checkin} → {ofertaSelecionada.valor.checkout} · {ofertaSelecionada.valor.quarto}</p>
              <strong className="offer-modal-price">{ofertaSelecionada.valor.preco ? dinheiro(ofertaSelecionada.valor.preco, ofertaSelecionada.valor.moeda) : "Consultar oferta"}</strong>
            </> : <>
              <span className="section-label">Passagem</span>
              <h3>{ofertaSelecionada.valor.companhia} · {ofertaSelecionada.valor.origem} → {ofertaSelecionada.valor.destino}</h3>
              <p>Ida: {ofertaSelecionada.valor.ida ? new Date(ofertaSelecionada.valor.ida).toLocaleString("pt-BR") : "Data informada"}<br />Volta: {ofertaSelecionada.valor.volta ? new Date(ofertaSelecionada.valor.volta).toLocaleString("pt-BR") : "Data informada"}<br />Total para {ofertaSelecionada.valor.passageiros} viajante(s)</p>
              <strong className="offer-modal-price">{dinheiro(ofertaSelecionada.valor.preco, ofertaSelecionada.valor.moeda)}</strong>
            </>}
            <small className="planning-source">{ofertaSelecionada.valor.fonte}. O valor será somado ao total da viagem.</small>
            <div className="offer-modal-actions"><button className="secondary-button" type="button" onClick={() => setOfertaSelecionada(null)}>Voltar</button><button className="primary-button" type="button" onClick={confirmarOferta}><Check size={15} /> Adicionar ao roteiro</button></div>
            {ofertaSelecionada.tipo === "hospedagem" && ofertaSelecionada.valor.latitude && ofertaSelecionada.valor.longitude && <a className="offer-map-link" href={`https://www.google.com/maps/search/?api=1&query=${ofertaSelecionada.valor.latitude},${ofertaSelecionada.valor.longitude}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ver localização no Google Maps</a>}
          </div>
        </div>
      )}
    </div>
    );
  }
