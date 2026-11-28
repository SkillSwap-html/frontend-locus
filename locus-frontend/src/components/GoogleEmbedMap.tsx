import { chaveGoogleMapsEmbed, urlGoogleMapsEmbed } from "@/services/googleMapsEmbed";

export function GoogleEmbedMap({
  nome,
  endereco,
  lat,
  lng,
}: {
  nome: string;
  endereco?: string;
  lat: number;
  lng: number;
}) {
  const chave = chaveGoogleMapsEmbed();
  const consulta = [nome, endereco].filter(Boolean).join(", ");
  const src = chave
    ? urlGoogleMapsEmbed("place", {
        q: consulta,
        center: `${lat},${lng}`,
        zoom: "17",
      })
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
