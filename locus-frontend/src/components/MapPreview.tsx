import type { Lugar } from "@/types";
import { Map, MapPin, ScanEye } from "lucide-react";

export function MapPreview({
  lugares,
  onVisualizarMapa,
  onVisualizarStreetView,
}: {
  lugares: Lugar[];
  onVisualizarMapa?: (lugar: Lugar) => void;
  onVisualizarStreetView?: (lugar: Lugar) => void;
}) {
  const principais = lugares.filter((lugar) => lugar.nome).slice(0, 6);
  if (!principais.length) return null;
  const primeiro = principais[0]!;

  return (
    <div className="map-preview map-preview-links" aria-label="Locais encontrados no Google Maps">
      <div className="map-preview-heading">
        <MapPin size={18} />
        <div>
          <strong>Locais encontrados</strong>
          <span>Visualize a localização real no mapa ou no Street View, dentro do Locus.</span>
        </div>
      </div>
      <div className="map-preview-place-list">
        {principais.map((lugar) => (
          <div className="map-preview-place" key={lugar.placeId || lugar.nome}>
            <div className="map-preview-place-info">
              <strong>{lugar.nome}</strong>
              <small>{lugar.endereco || "Endereço não informado"}</small>
            </div>
            <div className="map-preview-place-actions">
              <button type="button" onClick={() => onVisualizarMapa?.(lugar)} aria-label={`Ver ${lugar.nome} no mapa dentro do Locus`}>
                <Map size={12} /> Mapa
              </button>
              <button type="button" onClick={() => onVisualizarStreetView?.(lugar)} aria-label={`Ver ${lugar.nome} no Street View dentro do Locus`}>
                <ScanEye size={12} /> Street View
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="map-preview-actions">
        <button type="button" onClick={() => onVisualizarMapa?.(primeiro)}>Ver mapa <Map size={13} /></button>
        <button type="button" onClick={() => onVisualizarStreetView?.(primeiro)}>Ver Street View <ScanEye size={13} /></button>
      </div>
    </div>
  );
}
