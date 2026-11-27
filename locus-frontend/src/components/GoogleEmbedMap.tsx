import { chaveGoogleMapsEmbed, urlGoogleMapsEmbed } from "@/services/googleMapsEmbed";

export function GoogleEmbedMap({
  nome,
  endereco,
  placeId,
  lat,
  lng,
}: {
  nome: string;
  endereco?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}) {
  const chave = chaveGoogleMapsEmbed();
  const coordenadas = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0
    ? `${lat},${lng}`
    : "";
  const consulta = [nome, endereco, coordenadas].filter(Boolean).join(", ");
  const placeIdLimpo = placeId?.replace(/^places\//, "").trim();
  const placeIdValido = Boolean(placeIdLimpo && placeIdLimpo.length >= 20 && /^[A-Za-z0-9_-]+$/.test(placeIdLimpo));
  const src = chave
    ? urlGoogleMapsEmbed("place", { q: placeIdValido ? `place_id:${placeIdLimpo}` : consulta })
    : "";

  return (
    <div className="map-preview location-embed-map" aria-label="Google Maps do local">
      {src ? (
        <iframe
          className="map-embed-frame"
          title={`Mapa de ${nome}`}
          src={src}
          loading="lazy"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="map-preview-error">
          Configure VITE_GOOGLE_MAPS_EMBED_API_KEY no frontend para abrir o mapa dentro do Locus.
        </div>
      )}
    </div>
  );
}
