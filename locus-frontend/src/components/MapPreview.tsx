import type { Lugar } from "@/types";

export function MapPreview({ lugares }: { lugares: Lugar[] }) {
  const pontos = lugares.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)).slice(0, 6);
  const primeiro = pontos[0];

  if (!lugares.length) return null;
  if (!primeiro)
    return (
      <div className="map-preview map-preview-empty">
        <strong>Confira os lugares no Google Maps</strong>
        <span>Você pode abrir o endereço e o Street View de cada lugar antes de escolher.</span>
      </div>
    );

  const mapaSemChave = `https://www.google.com/maps?q=${encodeURIComponent(`${primeiro.lat},${primeiro.lng}`)}&output=embed`;
  return (
    <div className="map-preview" aria-label="Mapa dos lugares encontrados">
      <iframe
        className="map-preview-frame"
        src={mapaSemChave}
        title="Mapa dos lugares encontrados"
        loading="lazy"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
      />
      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${primeiro.lat},${primeiro.lng}`)}`} target="_blank" rel="noreferrer">
        Abrir no Google Maps
      </a>
    </div>
  );
}
