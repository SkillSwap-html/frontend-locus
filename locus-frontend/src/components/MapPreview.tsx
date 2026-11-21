import type { Lugar } from "@/types";
import { ExternalLink, MapPin } from "lucide-react";

function coordenadasValidas(lugar: Lugar): boolean {
  return Number.isFinite(lugar.lat)
    && Number.isFinite(lugar.lng)
    && !(lugar.lat === 0 && lugar.lng === 0);
}

function urlMaps(lugar: Lugar): string {
  const consulta = coordenadasValidas(lugar)
    ? `${lugar.lat},${lugar.lng}`
    : [lugar.nome, lugar.endereco].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

function urlStreetView(lugar: Lugar): string {
  if (coordenadasValidas(lugar)) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lugar.lat},${lugar.lng}`;
  }
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
            <span>{lugar.nome}</span>
            <div>
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
