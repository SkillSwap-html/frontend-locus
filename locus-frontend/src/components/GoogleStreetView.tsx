import { chaveGoogleMapsEmbed, urlGoogleMapsEmbed } from "@/services/googleMapsEmbed";

export function GoogleStreetView({
  lat,
  lng,
  panoramaLat,
  panoramaLng,
  className = "street-view-frame",
  imagemUrl: _imagemUrl,
}: {
  lat: number;
  lng: number;
  panoramaLat?: number;
  panoramaLng?: number;
  className?: string;
  imagemUrl?: string | undefined;
}) {
  const chave = chaveGoogleMapsEmbed();
  const latitude = Number.isFinite(panoramaLat) ? panoramaLat : lat;
  const longitude = Number.isFinite(panoramaLng) ? panoramaLng : lng;
  const src = chave
    ? urlGoogleMapsEmbed("streetview", {
        location: `${latitude},${longitude}`,
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
