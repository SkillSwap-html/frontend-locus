import { chaveGoogleMapsEmbed, urlGoogleMapsEmbed } from "@/services/googleMapsEmbed";

export function GoogleStreetView({
  lat,
  lng,
  endereco,
  placeId,
  className = "street-view-frame",
  imagemUrl: _imagemUrl,
}: {
  lat?: number;
  lng?: number;
  endereco?: string;
  placeId?: string;
  className?: string;
  imagemUrl?: string | undefined;
}) {
  const chave = chaveGoogleMapsEmbed();
  const coordenadas = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0
    ? `${lat},${lng}`
    : "";
  // Street View usa as coordenadas confirmadas pelo Places para encontrar a
  // panorâmica mais próxima; se a IA não trouxe coordenadas, usa o endereço.
  // O placeId continua sendo útil para o mapa, mas não é usado como location
  // do modo streetview.
  void placeId;
  const location = coordenadas || endereco?.trim() || "";
  const src = chave
    ? location
      ? urlGoogleMapsEmbed("streetview", {
        location,
        radius: "1500",
        heading: "0",
        pitch: "0",
        fov: "90",
      })
      : ""
    : "";

  return (
    <div className={`${className} street-view-google street-view-embed`}>
      {src ? (
        <iframe
          className="street-view-embed-frame"
          title="Street View do local"
          src={src}
          loading="lazy"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="street-view-error">
          Configure VITE_GOOGLE_MAPS_EMBED_API_KEY no frontend para abrir o Street View dentro do Locus.
        </div>
      )}
    </div>
  );
}
