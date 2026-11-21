import { useState, type FormEvent } from "react";
import { Check, Plane, Search, Sparkles } from "lucide-react";
import { buscarHoteis, buscarVoos } from "@/services/integracoes";
import type { CategoriaOrcamento, OfertaHotel, OfertaVoo, Recomendacao, Viagem } from "@/types";

type Etapa = "passagem" | "hospedagem" | "roteiro";

const dinheiro = (valor: number, moeda: string) => {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL" }).format(valor);
  } catch {
    return `${moeda || "BRL"} ${valor.toFixed(2)}`;
  }
};

function oferta(
  tipo: "voo" | "hospedagem",
  titulo: string,
  resumo: string,
  valor: number,
  fonte: string,
  categoria: CategoriaOrcamento,
): Recomendacao {
  return {
    id: `${tipo}-${Date.now()}`,
    tipo,
    titulo,
    resumo,
    justificativa: "Escolhida por você na consulta de ofertas.",
    evidencia: { fonte, consultadoEm: new Date().toISOString() },
    ...(valor > 0 ? { valor } : {}),
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
  const [origem, setOrigem] = useState(viagem?.origem?.slice(0, 3).toUpperCase() || "");
  const [destino, setDestino] = useState(viagem?.destino?.slice(0, 3).toUpperCase() || "");
  const [ida, setIda] = useState(viagem?.dataInicio || "");
  const [volta, setVolta] = useState(viagem?.dataFim || "");
  const [cidade, setCidade] = useState(viagem?.destino?.slice(0, 3).toUpperCase() || "");
  const [entrada, setEntrada] = useState(viagem?.dataInicio || "");
  const [saida, setSaida] = useState(viagem?.dataFim || "");
  const [voos, setVoos] = useState<OfertaVoo[]>([]);
  const [hoteis, setHoteis] = useState<OfertaHotel[]>([]);
  const [carregando, setCarregando] = useState(false);
  const restante = limite == null ? undefined : Math.max(0, limite - acumulado);

  function podeAdicionar(valor: number): boolean {
    return restante == null || valor <= restante;
  }

  function adicionar(tipo: "voo" | "hospedagem", titulo: string, resumo: string, valor: number, fonte: string, categoria: CategoriaOrcamento) {
    if (!podeAdicionar(valor)) {
      onToast("Essa opção ultrapassa o limite restante do seu orçamento. Escolha outra oferta.");
      return;
    }
    onAdicionar(oferta(tipo, titulo, resumo, valor, fonte, categoria));
  }

  async function pesquisarVoos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!origem || !destino || !ida) {
      onToast("Informe origem, destino e data de ida para consultar passagens.");
      return;
    }
    setCarregando(true);
    try {
      const resultado = await buscarVoos({ originLocationCode: origem, destinationLocationCode: destino, departureDate: ida, ...(volta ? { returnDate: volta } : {}), adults: 1, max: 6 });
      setVoos(resultado);
      onToast(resultado.length ? "Passagens encontradas. Escolha uma para continuar." : "Nenhuma passagem encontrada para esses filtros.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível consultar as passagens.");
    } finally {
      setCarregando(false);
    }
  }

  async function pesquisarHoteis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cidade || !entrada || !saida) {
      onToast("Informe o código da cidade e as datas da hospedagem.");
      return;
    }
    setCarregando(true);
    try {
      const resultado = await buscarHoteis({ cityCode: cidade, checkInDate: entrada, checkOutDate: saida, adults: 1, roomQuantity: 1 });
      setHoteis(resultado);
      onToast(resultado.length ? "Hospedagens encontradas. Escolha uma para continuar." : "Nenhuma hospedagem encontrada para esses filtros.");
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
          <small className="planning-source">Os valores exibidos podem ser simulados para demonstração.</small>
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
            <label>Origem<input value={origem} onChange={(event) => setOrigem(event.target.value.toUpperCase())} placeholder="SSA" maxLength={3} /></label>
            <label>Destino<input value={destino} onChange={(event) => setDestino(event.target.value.toUpperCase())} placeholder="CUR" maxLength={3} /></label>
          </div>
          <div className="form-grid compact">
            <label>Ida<input type="date" value={ida} onChange={(event) => setIda(event.target.value)} /></label>
            <label>Volta<input type="date" value={volta} onChange={(event) => setVolta(event.target.value)} /></label>
          </div>
          <button className="secondary-button full-button" disabled={carregando} type="submit"><Search size={15} />{carregando ? "Consultando..." : "Buscar passagens"}</button>
          {voos.map((voo) => {
            const acima = !podeAdicionar(voo.preco);
            return <div className={`offer-result ${acima ? "over-budget" : ""}`} key={voo.id}>
              <div><strong>{voo.companhia}</strong><small>{voo.origem} → {voo.destino} · {voo.fonte}</small></div>
              <b>{dinheiro(voo.preco, voo.moeda)}</b>
              <button type="button" disabled={acima} onClick={() => adicionar("voo", `Passagem ${voo.origem} → ${voo.destino}`, `${voo.companhia} · ${dinheiro(voo.preco, voo.moeda)}`, voo.preco, voo.fonte, "passagem")}><Check size={14} />{acima ? "Acima do limite" : "Escolher"}</button>
            </div>;
          })}
        </form>
      )}
      {etapa === "hospedagem" && (
        <form className="planning-form" onSubmit={(event) => void pesquisarHoteis(event)}>
          <label>Código da cidade<input value={cidade} onChange={(event) => setCidade(event.target.value.toUpperCase())} placeholder="CUR" maxLength={3} /></label>
          <div className="form-grid compact">
            <label>Entrada<input type="date" value={entrada} onChange={(event) => setEntrada(event.target.value)} /></label>
            <label>Saída<input type="date" value={saida} onChange={(event) => setSaida(event.target.value)} /></label>
          </div>
          <button className="secondary-button full-button" disabled={carregando} type="submit"><Search size={15} />{carregando ? "Consultando..." : "Buscar hospedagens"}</button>
          {hoteis.map((hotel) => {
            const acima = hotel.preco > 0 && !podeAdicionar(hotel.preco);
            return <div className={`offer-result ${acima ? "over-budget" : ""}`} key={hotel.id}>
              <div><strong>{hotel.hotel}</strong><small>{hotel.checkin} → {hotel.checkout} · {hotel.fonte}</small></div>
              <b>{hotel.preco ? dinheiro(hotel.preco, hotel.moeda) : "Consultar"}</b>
              <button type="button" disabled={acima} onClick={() => adicionar("hospedagem", hotel.hotel, `${hotel.quarto} · ${hotel.preco ? dinheiro(hotel.preco, hotel.moeda) : "Oferta consultada"}`, hotel.preco, hotel.fonte, "hospedagem")}><Check size={14} />{acima ? "Acima do limite" : "Escolher"}</button>
            </div>;
          })}
        </form>
      )}
      {etapa === "roteiro" && <div className="planning-next-step"><Plane size={20} /><p>Escolha os lugares buscados pela IA ou pesquise ao lado. O Locus organiza os pontos próximos e calcula o deslocamento antes de adicionar ao roteiro.</p></div>}
    </div>
  );
}
