import type { Lugar } from "@/types";
import { ExternalLink, MapPin } from "lucide-react";

function consultaDoLugar(lugar: Lugar): string {
  return [lugar.nome, lugar.endereco].filter(Boolean).join(", ");
}

function urlMaps(lugar: Lugar): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consultaDoLugar(lugar))}`;
}

function urlStreetView(lugar: Lugar): string {
  // O Google Maps resolve o local pelo nome + endereço e, a partir da página
  // correta do lugar, permite abrir a panorâmica Street View disponível.
  return urlMaps(lugar);
}

export function MapPreview({ lugares }: { lugares: Lugar[] }) {
  const principais = lugares.filter((lugar) => lugar.nome).slice(0, 6);
  if (!principais.length) return null;
  const primeiro = principais[0]!;

  return (
    <div className="map-preview map-preview-links" aria-label="Locais encontrados no Google Maps">
      <div className="map-preview-heading">
        <MapPin size={18} />
        <div>
          <strong>Locais encontrados</strong>
          <span>Abra a localização real no Google Maps ou no Street View.</span>
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
              <a href={urlMaps(lugar)} target="_blank" rel="noreferrer" aria-label={`Abrir ${lugar.nome} no Google Maps`}>
                <ExternalLink size={12} /> Maps
              </a>
              <a href={urlStreetView(lugar)} target="_blank" rel="noreferrer" aria-label={`Abrir ${lugar.nome} no Street View`}>
                <ExternalLink size={12} /> Street View
              </a>
            </div>
          </div>
        ))}
      </div>
      <div className="map-preview-actions">
        <a href={urlMaps(primeiro)} target="_blank" rel="noreferrer">Abrir no Google Maps <ExternalLink size={13} /></a>
        <a href={urlStreetView(primeiro)} target="_blank" rel="noreferrer">Abrir Street View <ExternalLink size={13} /></a>
      </div>
    </div>
  );
}
