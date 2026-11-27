import { chaveGoogleMapsEmbed, urlGoogleMapsEmbed } from "@/services/googleMapsEmbed";

export function GoogleStreetView({
  nome,
  endereco,
  lat,
  lng,
  className = "street-view-frame",
  imagemUrl: _imagemUrl,
}: {
  nome?: string;
  endereco?: string;
  lat: number;
  lng: number;
  className?: string;
  imagemUrl?: string | undefined;
}) {
  const chave = chaveGoogleMapsEmbed();
  const consulta = [nome, endereco].filter((valor) => valor?.trim()).join(", ");
  const location = consulta || `${lat},${lng}`;
  const src = chave
    ? urlGoogleMapsEmbed("streetview", {
        location,
        heading: "0",
        pitch: "0",
        fov: "90",
      })
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
