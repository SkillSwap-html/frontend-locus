import { useEffect, useRef, useState } from "react";
import { carregarGoogleMaps } from "@/services/googleMaps";

export function GoogleStreetView({
  lat,
  lng,
  className = "street-view-frame",
  imagemUrl,
}: {
  lat: number;
  lng: number;
  className?: string;
  imagemUrl?: string | undefined;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [erro, setErro] = useState("");
  const [mostrarImagem, setMostrarImagem] = useState(false);

  useEffect(() => {
    let ativo = true;
    if (!elementRef.current) return undefined;
    setErro("");
    setMostrarImagem(false);
    void carregarGoogleMaps()
      .then((google) => {
        if (!ativo || !elementRef.current) return;
        const criarPanorama = (position: { lat: number; lng: number }) => {
          if (!ativo || !elementRef.current) return;
          const panorama = new google.maps.StreetViewPanorama(elementRef.current, {
            position,
            pov: { heading: 0, pitch: 0 },
            zoom: 1,
            visible: true,
            addressControl: true,
            fullscreenControl: true,
            linksControl: true,
            motionTrackingControl: false,
          });
          panorama.addListener("status_changed", () => {
            const status = panorama.getStatus?.();
            if (status && status !== google.maps.StreetViewStatus?.OK && ativo) {
              setErro("O Google não encontrou uma panorâmica próxima deste ponto.");
              setMostrarImagem(Boolean(imagemUrl));
            }
          });
        };
        // O ponto turístico pode não ter uma foto exatamente nas coordenadas
        // retornadas pelo Places. O serviço oficial procura a panorâmica mais
        // próxima para evitar o falso erro visto em praias e calçadões.
        new google.maps.StreetViewService().getPanorama(
          { location: { lat, lng }, radius: 2500, source: "OUTDOOR" },
          (data, status) => {
            if (!ativo) return;
            const position = data?.location?.latLng;
            if (status === google.maps.StreetViewStatus?.OK && position) {
              criarPanorama(position);
            } else {
              setErro("O Google não encontrou uma panorâmica pública próxima deste ponto.");
              setMostrarImagem(Boolean(imagemUrl));
            }
          },
        );
      })
      .catch((error: unknown) => {
        if (ativo) {
          setErro(error instanceof Error ? error.message : "O Street View não pôde ser carregado.");
          setMostrarImagem(Boolean(imagemUrl));
        }
      });
    return () => {
      ativo = false;
    };
  }, [lat, lng, imagemUrl]);

  return (
    <div className={`${className} street-view-google`}>
      {mostrarImagem && imagemUrl ? (
        <img
          className="street-view-google-image"
          src={imagemUrl}
          alt="Imagem do Google Street View"
          onError={() => {
            setMostrarImagem(false);
            setErro("A imagem do Street View não pôde ser carregada.");
          }}
        />
      ) : <div ref={elementRef} className="street-view-google-canvas" />}
      {erro && !mostrarImagem && <div className="street-view-error">{erro}</div>}
    </div>
  );
}
